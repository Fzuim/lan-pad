import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { isSeaRuntime } from './sea.js'

/**
 * 单文件 exe 运行时以 exe 所在目录为根目录，避免“从哪里双击”影响数据位置。
 * 源码/dev 运行时仍然是当前工作目录。
 */
export const PACKAGED = isSeaRuntime()
export const ROOT = PACKAGED ? path.dirname(process.execPath) : process.cwd()

if (PACKAGED) {
  try {
    process.chdir(ROOT)
  } catch {
    // 只影响相对路径，失败不致命
  }
}

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true })

export const PORT = Number(process.env.PORT || 8787)
export const HOST = process.env.HOST || '0.0.0.0'
export const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data')
export const CLIENT_DIR = path.resolve(ROOT, 'dist/client')
export const DB_FILE = path.join(DATA_DIR, 'lanpad.db')
export const ASSETS_DIR = path.join(DATA_DIR, 'assets')
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || ''

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(ASSETS_DIR, { recursive: true })

function loadHostKey(): string {
  if (process.env.HOST_KEY) return process.env.HOST_KEY
  const file = path.join(DATA_DIR, 'host-key.txt')
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file, 'utf8').trim()
    if (key) return key
  }
  const key = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(file, key, { encoding: 'utf8', mode: 0o600 })
  return key
}

export const HOST_KEY = loadHostKey()
