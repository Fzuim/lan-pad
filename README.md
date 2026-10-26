# LAN Pad · 局域网题目协作

一个给队内比赛用的轻量协作文档：**文字 + 代码块 + 截图**，主机启动服务，队友用局域网链接打开即可一起编辑。

- 免登录、无账号；链接即房间
- 实时同步（Yjs + Hocuspocus）
- 自定义名字、颜色、在线状态和远端光标
- 代码块语法高亮 + 语言选择 + 复制
- 截图 `Ctrl/⌘+V` 粘贴、拖拽或选择文件；点击放大
- 支持从网页、Word、WPS、聊天工具直接复制图文混排，图片自动上传
- SQLite 持久化，重启不丢；图片存本地
- 首页可删除文档（需要主机密钥，软删除）
- Windows 上 `npm start` 或双击 `start.bat`

![LAN Pad 文档页：文字、代码块和截图](docs/screenshot.png)

设计方案（调研、架构、取舍）见 [design.md](design.md)。

---

## 环境要求

- **Node.js ≥ 22.12**（本机实测 22.22；推荐 24 LTS）
- Windows 10/11 / macOS / Linux 均可作为主机
- 队友只需要 Chrome / Edge / Firefox 等现代浏览器
- 主机和队友在同一局域网

> 项目使用 Node 内置的 `node:sqlite`，首次启动可能出现一行 `ExperimentalWarning`，不影响使用。

---

## 快速开始

```bash
npm install
npm run build
npm start
```

启动后控制台会打印：

```text
本机访问:   http://localhost:8787
局域网访问: http://192.168.x.x:8787
主机密钥:   ...
```

把“局域网访问”地址发给队友即可。也可以直接双击 `start.bat`（首次会自动安装/构建并打开浏览器）。

### 开发模式

```bash
npm run dev
```

- 前端：<http://localhost:5173>
- 后端/WS：<http://localhost:8787>
- Vite 已配置 `/api`、`/assets`、`/collab` 代理

### 环境变量

复制 `.env.example` 为 `.env`，按需修改：

```ini
PORT=8787
HOST=0.0.0.0
DATA_DIR=./data
# PUBLIC_BASE_URL=http://192.168.1.23:8787
# HOST_KEY=...
```

- `PUBLIC_BASE_URL`：自动探测的 IP 不对时，手动指定复制出去的地址。
- `HOST_KEY`：主机密钥；不填则首次启动自动生成到 `data/host-key.txt`。

---

## 使用方式

1. 主机打开首页，点“新建文档”。
2. 点“分享”，复制带本机 IP 的链接，发到群里。
3. 队友打开链接，第一次会弹窗填名字；之后自动记住。
4. 正文里可以直接：
   - 输入文字，或用工具栏加粗/标题/列表/引用；
   - 点“代码块”，选择 C++ / Python / Java 等语言；
   - `Ctrl/⌘+V` 粘贴截图，或把图片拖进正文；
   - 从网页/Word/WPS 复制“文字 + 图片”直接粘贴，图片会自动上传；
   - 点击图片打开灯箱，`Esc` 关闭。
5. 顶部会显示在线队友、颜色、同步状态。

> `?name=红队-01` 可以给固定电脑预填名字；`?mode=view` 是只读查看（v0.1 仅前端约束，不是安全边界）。

---

## Windows 防火墙

首次启动 Windows 可能弹窗，勾选“专用网络”。如果队友打不开，用管理员 PowerShell 执行：

```powershell
New-NetFirewallRule `
  -DisplayName "LAN Pad 8787" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8787 `
  -Action Allow `
  -Profile Private `
  -RemoteAddress LocalSubnet
```

或：

```bat
netsh advfirewall firewall add rule name="LAN Pad 8787" dir=in action=allow protocol=TCP localport=8787 remoteip=LocalSubnet profile=private
```

如果当前网络被识别为“公用网络”，把网络改为“专用”，或临时把规则改成 `-Profile Any`（确认现场网络可信）。

排查顺序：

1. 两台电脑是否同一网段（`ipconfig` 对比前三位）。
2. 队友能否 `ping 192.168.x.x`。
3. 防火墙是否放行 8787。
4. 是否连了 VPN / 虚拟机网卡，首页选错 IP。
5. 路由器是否开了 AP 隔离/客户端隔离。
6. 公司 Wi-Fi 是否禁止终端互访。

---

## 数据、备份与主机操作

```text
data/
├─ lanpad.db          # SQLite：文档、版本、图片元数据
├─ host-key.txt       # 主机密钥
└─ assets/<docId>/    # 截图文件
```

- 比赛结束后直接复制整个 `data/` 目录归档。
- 恢复：停服务，替换 `data/lanpad.db`，再启动。
- 不要把 `data/` 放在 OneDrive/坚果云同步目录，SQLite WAL 容易被锁坏。
- 删除文档（软删除）需要主机密钥：

```bash
curl -X DELETE \
  -H "X-Host-Key: <data/host-key.txt 里的值>" \
  http://127.0.0.1:8787/api/docs/<docId>
```

v0.1 首页文档卡片右侧已经有“删除”按钮：第一次删除会提示输入主机密钥，校验通过后软删除并从列表移除，密钥保存在当前标签页的 `sessionStorage` 里。队友没有密钥，不能删文档。

---

## 本地验证脚本

已带几条无需浏览器的 smoke test：

```bash
# 两个 Yjs 客户端实时同步
node scripts/test-sync.mjs <docId>

# 重新连接并读取 SQLite 中的内容
node scripts/test-load.mjs <docId>

# 浏览器 E2E（需要本机 Chrome + 已启动服务）
node scripts/test-browser.mjs

# 首页/截图粘贴/只读模式
node scripts/test-ui.mjs

# 在线人数
node scripts/test-online.mjs

# 服务重启 + 客户端重连
node scripts/test-reconnect.mjs

# 真实剪贴板图片粘贴（Playwright）
node scripts/test-clipboard.mjs

# 富文本 + 多图混合粘贴
node scripts/test-mixed-paste.mjs
```

浏览器脚本默认使用 `C:\Program Files\Google\Chrome\Application\chrome.exe`，可用 `CHROME_PATH` 覆盖；服务地址可用 `BASE_URL` 覆盖。

---

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/network` | 本机局域网地址 |
| `GET` | `/api/docs` | 文档列表 |
| `POST` | `/api/docs` | 新建文档 |
| `GET` | `/api/docs/:id` | 文档元数据 |
| `DELETE` | `/api/docs/:id` | 软删除（需 `X-Host-Key`） |
| `POST` | `/api/docs/:id/assets` | 上传截图 |
| `GET` | `/assets/:docId/:filename` | 读取截图 |
| `WS` | `/collab` | Hocuspocus/Yjs 同步 |

---

## 目录结构

```text
server/
  index.ts       Express + WebSocket upgrade + API
  db.ts          SQLite schema / CRUD
  collab.ts      Hocuspocus、在线状态、持久化钩子
  assets.ts      截图校验/存储
  network.ts     局域网 IP 探测
  config.ts      环境变量与数据目录
src/
  App.tsx        路由
  components/    首页、文档页、工具栏、名字/分享弹窗
  api.ts         前端 API
  styles.css     全部样式
scripts/         同步/浏览器测试
design.md        设计方案
```

---

## 已知限制（v0.1）

- 无账号体系；拿到链接的人都能编辑。适合可信的队内局域网。
- `?mode=view` 只隐藏工具栏并设置 `contenteditable=false`，不是服务端强制只读。
- 没有版本恢复 UI、导出 PDF/Markdown 的完整实现。
- 没有离线 IndexedDB 缓存；页面刷新需要服务在线。
- 大文档/大图仅做基础限制（文本建议 <5MB，图片 ≤10MB、宽度 ≤2560）。
- 复杂 Word 表格/样式会做简化，正文和图片会保留；需要表格/公式可以后续补。
- 部分 WPS/Word 版本只在 HTML 里放本地 `file://` 图片路径，程序会尝试从 RTF 剪贴板提取图片；如果源程序只提供浏览器无法解码的 EMF，仍会提示单独截图。
- `node:sqlite` 在 Node 22 仍标记为 experimental；正式长期使用可换 `better-sqlite3`。

后续如果比赛现场需要，我可以继续补：访问码、签名只读链接、版本恢复、导出。
