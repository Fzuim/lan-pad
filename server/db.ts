import { DatabaseSync } from 'node:sqlite'
import * as Y from 'yjs'
import { DB_FILE } from './config.js'

export type DocMeta = {
  id: string
  title: string
  created_at: number
  updated_at: number
  last_editor: string | null
}

export type DocRow = DocMeta & {
  state: Uint8Array | null
  last_version_at: number
  deleted_at: number | null
}

export type AssetRow = {
  id: string
  doc_id: string
  sha256: string
  filename: string
  mime: string
  size: number
  width: number | null
  height: number | null
  created_at: number
}

const db = new DatabaseSync(DB_FILE)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS docs (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '未命名文档',
    state           BLOB,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_editor     TEXT,
    last_version_at INTEGER NOT NULL DEFAULT 0,
    deleted_at      INTEGER
  );

  CREATE TABLE IF NOT EXISTS versions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     TEXT NOT NULL,
    state      BLOB NOT NULL,
    title      TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_versions_doc ON versions(doc_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS assets (
    id         TEXT PRIMARY KEY,
    doc_id     TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    width      INTEGER,
    height     INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(doc_id, sha256)
  );
  CREATE INDEX IF NOT EXISTS idx_assets_doc ON assets(doc_id);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

const insertDocStmt = db.prepare(`
  INSERT INTO docs (id, title, state, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`)

export function createDoc(id: string, title: string): DocMeta {
  const now = Date.now()
  const cleanTitle = title.trim().slice(0, 120) || '未命名文档'
  const doc = new Y.Doc()
  doc.getText('title').insert(0, cleanTitle)
  const state = Y.encodeStateAsUpdate(doc)
  insertDocStmt.run(id, cleanTitle, state, now, now)
  doc.destroy()
  return { id, title: cleanTitle, created_at: now, updated_at: now, last_editor: null }
}

export function listDocs(): DocMeta[] {
  return db
    .prepare(
      `SELECT id, title, created_at, updated_at, last_editor
       FROM docs
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 500`,
    )
    .all() as unknown as DocMeta[]
}

export function getDocMeta(id: string): DocMeta | null {
  const row = db
    .prepare(
      `SELECT id, title, created_at, updated_at, last_editor
       FROM docs
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as unknown as DocMeta | undefined
  return row ?? null
}

export function getDocRow(id: string): DocRow | null {
  const row = db
    .prepare(
      `SELECT id, title, state, created_at, updated_at, last_editor, last_version_at, deleted_at
       FROM docs
       WHERE id = ?`,
    )
    .get(id) as unknown as DocRow | undefined
  return row ?? null
}

export function updateDocState(
  id: string,
  state: Uint8Array,
  title: string,
  lastEditor: string | null,
): void {
  const now = Date.now()
  db.prepare(
    `UPDATE docs
     SET state = ?, title = ?, updated_at = ?, last_editor = COALESCE(?, last_editor)
     WHERE id = ?`,
  ).run(state, title.slice(0, 120) || '未命名文档', now, lastEditor, id)
}

export function insertVersionIfDue(id: string, state: Uint8Array, title: string): void {
  const row = getDocRow(id)
  if (!row) return
  const now = Date.now()
  const fiveMinutes = 5 * 60 * 1000
  if (now - row.last_version_at < fiveMinutes) return

  db.prepare(
    `INSERT INTO versions (doc_id, state, title, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, state, title, now)

  db.prepare(
    `DELETE FROM versions
     WHERE doc_id = ?
       AND id NOT IN (
         SELECT id FROM versions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 50
       )`,
  ).run(id, id)

  db.prepare(`UPDATE docs SET last_version_at = ? WHERE id = ?`).run(now, id)
}

export function softDeleteDoc(id: string): boolean {
  const result = db
    .prepare(`UPDATE docs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .run(Date.now(), id)
  return Number(result.changes) > 0
}

export function addAsset(asset: {
  id: string
  docId: string
  sha256: string
  filename: string
  mime: string
  size: number
  width: number | null
  height: number | null
}): AssetRow {
  db.prepare(
    `INSERT OR IGNORE INTO assets
      (id, doc_id, sha256, filename, mime, size, width, height, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    asset.id,
    asset.docId,
    asset.sha256,
    asset.filename,
    asset.mime,
    asset.size,
    asset.width,
    asset.height,
    Date.now(),
  )

  return getAssetByFilename(asset.docId, asset.filename)!
}

export function getAssetByFilename(docId: string, filename: string): AssetRow | null {
  const row = db
    .prepare(
      `SELECT id, doc_id, sha256, filename, mime, size, width, height, created_at
       FROM assets
       WHERE doc_id = ? AND filename = ?`,
    )
    .get(docId, filename) as unknown as AssetRow | undefined
  return row ?? null
}

export function closeDb(): void {
  try {
    db.close()
  } catch {
    // already closed
  }
}
