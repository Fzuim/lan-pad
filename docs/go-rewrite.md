# Go 版本翻写说明

分支：`feat/go-rewrite`。目标是保留现有 React + Tiptap 前端，把 Node/Express/Hocuspocus
后端换成纯 Go 单进程服务，最终得到一个不依赖 Node 运行时的单文件程序。

当前状态：**后端功能已跑通**，可以完整替代 Node 服务；前端只改了实时同步的 provider。

---

## 为什么不是“把 Express 换成 Gin”这么简单

真正的难点是实时协作。前端用的是 Yjs，服务端必须能读懂 Yjs 的二进制 update、state vector
和 awareness，并维护每个文档的 CRDT 状态。自己实现一遍 Yjs 协议风险很高，所以选用了：

- [ygo](https://github.com/Deln0r/ygo) `v1.29.0`：纯 Go 的 Yjs 端口，V1/V2 线格式与
  `yjs@13.6.33` 双向兼容，自带 Hocuspocus/y-websocket 同步服务器、SQLite 持久化接口；
- `modernc.org/sqlite`：纯 Go SQLite，无 CGO，交叉编译和单文件分发都简单。

### 一个关键取舍：前端改用 y-websocket

Hocuspocus v4 客户端在每一帧前面写 `documentName`，而 ygo 的帧格式是
`[messageType][payload]`（y-websocket 协议）。两者并不兼容，这一点与部分宣传文案不符。
因此前端把 `@hocuspocus/provider` 换成了 `y-websocket`：

- `WebsocketProvider(url, docId, ydoc, { params: { user, mode } })`；
- URL 变成 `/collab/<docId>`，ygo 用路径最后一段作为文档名；
- awareness 从 `provider.setAwarenessField` 改为 `provider.awareness.setLocalStateField`；
- 状态/同步事件从 `onStatus/onSynced` 改为 `status`/`sync` 事件。

Tiptap 的协作扩展只依赖 `provider.awareness`，所以编辑器代码不需要改。

---

## 目录结构

```text
cmd/lanpad/main.go            启动、端口占用提示、优雅退出、自动开浏览器
internal/config/              .env / 环境变量 / 数据目录 / host-key
internal/docstore/            SQLite：docs、versions、assets、doc_updates
internal/collab/              ygo 同步服务器、在线人数、只读、最后编辑者
internal/assets/              图片嗅探、SHA-256、去重落盘
internal/network/             局域网 IPv4 探测与排序
internal/web/                 REST API、图片、静态前端、安全响应头
internal/ids/                 文档 ID / 图片文件名校验
internal/openbrowser/         跨平台打开浏览器
scripts/test-go-sync.mjs      Go 服务端的双客户端同步/重连/只读测试
scripts/build-go.mjs          内嵌前端并编译单文件二进制
```

前端仍是 `src/`，构建产物是 `dist/client/`。开发时 Go 从磁盘读取；打包时
`scripts/build-go.mjs` 会把它复制到 `internal/web/dist` 并用 `go:embed` 打进二进制。

---

## 运行

```bash
# 1. 构建前端（改动前端后需要重新执行）
npm install
npm run build

# 2. 直接跑 Go 后端（从 dist/client 读前端）
npm start            # 等价于 go run ./cmd/lanpad

# 3. 或者编译单文件 exe（内嵌前端，不需要 dist/client）
npm run go:build     # release/LANPad.exe
./release/LANPad.exe
```

默认地址 <http://localhost:8787>，与 Node 版本一致。数据仍在 `./data/`。

`npm run dev` 现在同时启动 Vite 和 Go（`concurrently`）；旧的 `server/` Node 实现只作参考，
`npm run build:exe` 保留为旧 SEA 打包脚本。

### 单文件构建

`npm run go:build` 会：

1. 检查 `dist/client/index.html`；
2. 复制到 `internal/web/dist`；
3. 用 `-tags embedclient` 编译，把前端通过 `go:embed` 打进二进制；
4. 输出 `release/LANPad.exe`（约 12 MB）。

不带 `embedclient` 标签的 `go run` / `go build` 仍然从 `CLIENT_DIR`（默认
`./dist/client`）读取前端，方便改前端时热更新。

### 环境变量

与 Node 版本相同，另加两个 Go 侧变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | SQLite、图片、host-key |
| `PUBLIC_BASE_URL` | 自动探测 | 分享链接使用的外部地址 |
| `HOST_KEY` | 自动生成 | 删除文档用的主机密钥 |
| `LANPAD_OPEN` | `1` | `0` = 启动时不打开浏览器 |
| `LANPAD_ROOT` | 当前工作目录 | `.env` 和相对路径的锚点 |
| `CLIENT_DIR` | `./dist/client` | 前端构建产物目录 |

`.env` 会从 `LANPAD_ROOT/.env` 读取，已存在的进程环境变量优先。

### npm 快捷命令

```bash
npm run go:run     # go run ./cmd/lanpad
npm run go:build   # 编译 release/LANPad.exe（内嵌前端）
npm run go:test    # go test ./...
```

---

## 数据兼容

Go 版直接复用 Node 版的数据库结构，`data/lanpad.db` 可以双向打开：

- `docs.state` 仍然保存完整的 Yjs V1 update，Node 版可以直接读；
- 新增 `doc_updates` 表，作为 ygo 的 append-only update log；启动时会把只有
  `docs.state` 的旧文档自动补一条 log；
- `versions` 仍然是 5 分钟一次、最多 50 份；
- `assets`、`settings`、`host-key.txt` 不变。

单次编辑先同步写 log（掉电不丢），标题/`updated_at`/`docs.state` 由 800ms 防抖的
后台任务刷新；服务退出时强制落盘。每 200 条 update 会触发一次 log 压缩，避免长时间
协作把日志撑大。

---

## REST API

与 Node 版保持一致：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/network` | 局域网地址 |
| `GET` | `/api/docs` | 文档列表（可带 `?base=`） |
| `POST` | `/api/docs` | 新建文档 |
| `GET` | `/api/docs/:id` | 文档元数据 |
| `DELETE` | `/api/docs/:id` | 软删除，需 `X-Host-Key` |
| `POST` | `/api/docs/:id/assets` | 上传图片 |
| `GET` | `/assets/:docId/:filename` | 读取图片 |
| `WS` | `/collab/:docId` | Yjs + Awareness |

`POST /api/docs/:id/assets` 仍然限制 15 MB、只接受 PNG/JPEG/GIF/WebP，按 SHA-256 去重。

---

## 实时同步与在线状态

- ygo 负责 Sync Step1/2、增量 update、QueryAwareness、awareness 广播；
- 在线人数由 `OnConnect`/`OnDisconnect` 自己维护，与 Node 版的 socket 计数一致；
- `?mode=view` 现在由服务端强制：该连接发来的文档 update 会被直接丢弃，比 Node 版
  只在前端 `contenteditable=false` 更安全；
- `?user=名字` 作为“最后编辑者”的近似来源（Node 版取 awareness 里的名字，同样不是
  严格意义的上一个编辑者）；
- 文档不存在、ID 非法时 WebSocket 会被拒绝，不会像 Node 版那样产生空文档。

---

## 与 Node 版的已知差异

1. **前端 provider 改为 y-websocket**，不再是 Hocuspocus 协议。
2. **删除文档不会踢掉已连接的人**：ygo 没有按文档关闭连接的公开 API；已连接客户端
   仍可编辑，但文档会从列表消失，新连接会被拒绝。后续可以在 Manager 里记录连接并在
   删除时统一关闭。
3. **`last_editor` 是近似值**：来自最近连接（且非只读）的用户名，不是精确的“最后写入者”。
4. **没有 Origin 校验**：与 Node v0.1 一致，适合可信局域网；公网部署需要补。
5. **没有版本恢复接口**：`versions` 表仍然在写，但还没有像设计文档里那样的恢复 UI/API。

---

## 验证

```bash
# Go 单元/集成测试：docstore、assets、HTTP API、静态资源
go test ./...

# 双客户端同步 + awareness + 重连 + 服务端只读
node scripts/test-go-sync.mjs <docId> http://127.0.0.1:8787

# 浏览器端到端（需要已启动 Go 服务和本机 Chrome）
BASE_URL=http://127.0.0.1:8787 node scripts/test-browser.mjs
BASE_URL=http://127.0.0.1:8787 node scripts/test-ui.mjs
BASE_URL=http://127.0.0.1:8787 node scripts/test-online.mjs
```

已实测通过：中文标题/正文、代码块、图片上传与同步、灯箱、在线人数、断线重连、
`?mode=view` 服务端只读，以及从旧 Node 数据库启动。

---

## 下一步

1. 删除文档时关闭该文档的在线连接；
2. 版本列表/恢复到指定版本的 API + UI；
3. 把 `last_editor` 换成基于 awareness 的精确记录（需要在 ygo 连接层旁路解析 awareness）；
4. 增加访问码/签名只读链接（设计文档里的 v0.2 内容）；
5. 逐步移除 `server/` 下的 Node 实现，或保留为兼容分支。
