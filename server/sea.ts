import path from 'node:path'
import { getAsset, isSea } from 'node:sea'

/**
 * 单文件 exe（Node SEA）运行时检测。
 * 普通 `node dist/server/index.js` / `tsx server/index.ts` 下返回 false。
 */
export function isSeaRuntime(): boolean {
  try {
    return isSea()
  } catch {
    return false
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

export type ClientAsset = {
  body: Buffer
  type: string
}

/**
 * 从 SEA 注入的资源里读取前端文件。
 * key 使用相对 dist/client 的 POSIX 路径，例如 `index.html`、`static/index-xxx.js`。
 */
export function readClientAsset(pathname: string): ClientAsset | null {
  const key = pathname.replace(/^\/+/, '') || 'index.html'
  try {
    const value = getAsset(key)
    if (value === undefined) return null
    const body = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
    return {
      body,
      type: MIME_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream',
    }
  } catch {
    return null
  }
}
