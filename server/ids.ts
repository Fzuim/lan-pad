import crypto from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export function makeDocId(length = 12): string {
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

export function isDocId(value: string): boolean {
  return /^[0-9a-z]{12}$/.test(value)
}

export function isAssetFile(value: string): boolean {
  return /^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value)
}
