import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { ASSETS_DIR } from './config.js'
import { addAsset, getAssetByFilename } from './db.js'

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
})

type ImageInfo = { mime: string; ext: string }

export function detectImage(buffer: Buffer): ImageInfo | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer.toString('ascii', 1, 4) === 'PNG' &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  const head6 = buffer.toString('ascii', 0, Math.min(6, buffer.length))
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { mime: 'image/gif', ext: 'gif' }
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return null
}

function safeDimension(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null
  return Math.round(n)
}

export function saveAsset(params: {
  docId: string
  buffer: Buffer
  width: unknown
  height: unknown
}): { url: string; width: number | null; height: number | null; mime: string } {
  const info = detectImage(params.buffer)
  if (!info) {
    throw Object.assign(new Error('只支持 PNG / JPEG / GIF / WebP 图片'), { status: 415 })
  }

  const hash = crypto.createHash('sha256').update(params.buffer).digest('hex')
  const filename = `${hash}.${info.ext}`
  const dir = path.join(ASSETS_DIR, params.docId)
  fs.mkdirSync(dir, { recursive: true })

  const existing = getAssetByFilename(params.docId, filename)
  if (existing) {
    return {
      url: `/assets/${params.docId}/${filename}`,
      width: existing.width,
      height: existing.height,
      mime: existing.mime,
    }
  }

  const fullPath = path.join(dir, filename)
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, params.buffer)
  }

  const width = safeDimension(params.width)
  const height = safeDimension(params.height)
  addAsset({
    id: crypto.randomBytes(8).toString('hex'),
    docId: params.docId,
    sha256: hash,
    filename,
    mime: info.mime,
    size: params.buffer.byteLength,
    width,
    height,
  })

  return { url: `/assets/${params.docId}/${filename}`, width, height, mime: info.mime }
}
