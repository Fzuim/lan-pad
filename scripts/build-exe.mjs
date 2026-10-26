import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把服务端 + 前端打包成单个 Windows exe（Node SEA）。
 *
 * 产物：release/LANPad.exe
 * 首次双击运行时会在 exe 同目录创建 data/（SQLite + 图片 + host-key.txt）。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = path.join(root, '.build', 'exe')
const release = path.join(root, 'release')
const exeName = 'LANPad.exe'
const sentinelFuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

function fail(message) {
  console.error(`\n[build-exe] ${message}\n`)
  process.exit(1)
}

if (process.platform !== 'win32') {
  fail('当前脚本只生成 Windows exe；macOS/Linux 单文件需要用各自的 node 二进制。')
}

fs.rmSync(temp, { recursive: true, force: true })
fs.mkdirSync(temp, { recursive: true })
fs.mkdirSync(release, { recursive: true })

console.log('[1/5] 构建前端 (vite build) ...')
run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'])

console.log('[2/5] 打包服务端 (esbuild → CJS) ...')
run(process.execPath, [
  path.join(root, 'node_modules/esbuild/bin/esbuild'),
  path.join(root, 'server/index.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node22',
  `--outfile=${path.join(temp, 'server.cjs')}`,
  '--define:import.meta.url=__filename',
  '--external:bufferutil',
  '--external:utf-8-validate',
  '--log-level=warning',
])

console.log('[3/5] 生成 SEA 配置 ...')
const clientDir = path.join(root, 'dist/client')
if (!fs.existsSync(path.join(clientDir, 'index.html'))) {
  fail('dist/client/index.html 不存在，前端构建失败。')
}

const assets = {}
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collect(full)
    } else if (entry.isFile()) {
      const key = path.relative(clientDir, full).split(path.sep).join('/')
      assets[key] = full
    }
  }
}
collect(clientDir)

const seaConfig = {
  main: path.join(temp, 'server.cjs'),
  output: path.join(temp, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  // node:sqlite 在 Node 22 仍会打印 ExperimentalWarning，双击启动时不需要这行噪音
  execArgv: ['--no-warnings'],
  assets,
}
const configPath = path.join(temp, 'sea-config.json')
fs.writeFileSync(configPath, JSON.stringify(seaConfig, null, 2), 'utf8')

console.log('[4/5] 生成 SEA blob ...')
run(process.execPath, ['--experimental-sea-config', configPath])

console.log('[5/5] 注入 node.exe 生成单文件 exe ...')
const exePath = path.join(release, exeName)
fs.copyFileSync(process.execPath, exePath)
run(process.execPath, [
  path.join(root, 'node_modules/postject/dist/cli.js'),
  exePath,
  'NODE_SEA_BLOB',
  path.join(temp, 'sea-prep.blob'),
  '--sentinel-fuse',
  sentinelFuse,
])

const sizeMb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1)
console.log(`\n[build-exe] 完成: ${path.relative(root, exePath)} (${sizeMb} MB)`)
console.log('[build-exe] 把该 exe 发给别人，双击即可启动（首次运行会在同目录创建 data/）。')
