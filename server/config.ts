import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

export const ROOT = process.cwd()
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
