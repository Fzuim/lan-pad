import { Hocuspocus } from '@hocuspocus/server'
import * as Y from 'yjs'
import {
  getDocRow,
  insertVersionIfDue,
  updateDocState,
} from './db.js'

const onlineByDoc = new Map<string, Set<string>>()
const lastActiveByDoc = new Map<string, string>()

export function getOnlineCount(docId: string): number {
  return onlineByDoc.get(docId)?.size ?? 0
}

function addOnline(docId: string, socketId: string): void {
  let set = onlineByDoc.get(docId)
  if (!set) {
    set = new Set()
    onlineByDoc.set(docId, set)
  }
  set.add(socketId)
}

function removeOnline(docId: string, socketId: string): void {
  const set = onlineByDoc.get(docId)
  if (!set) return
  set.delete(socketId)
  if (set.size === 0) onlineByDoc.delete(docId)
}

function persistDocument(documentName: string, document: Y.Doc): void {
  const title = document.getText('title').toString().trim() || '未命名文档'
  const state = Y.encodeStateAsUpdate(document)
  const lastEditor = lastActiveByDoc.get(documentName) ?? null
  updateDocState(documentName, state, title, lastEditor)
  insertVersionIfDue(documentName, state, title)
}

export const hocuspocus = new Hocuspocus({
  name: 'lanpad',
  quiet: true,
  debounce: 800,
  maxDebounce: 4000,

  async onLoadDocument({ documentName }) {
    const row = getDocRow(documentName)
    const doc = new Y.Doc()
    if (row?.state) {
      Y.applyUpdate(doc, row.state)
    }
    return doc
  },

  async onStoreDocument({ documentName, document }) {
    persistDocument(documentName, document)
  },

  async connected({ documentName, socketId }) {
    addOnline(documentName, socketId)
  },

  async onDisconnect({ documentName, document, socketId, clientsCount }) {
    removeOnline(documentName, socketId)
    // Hocuspocus debounces stores; when the last editor leaves, make sure the
    // final Yjs update is not lost when the document is unloaded.
    if (clientsCount <= 1) persistDocument(documentName, document)
  },

  async onAwarenessUpdate({ documentName, states }) {
    for (const state of states) {
      const user = (state as { user?: { name?: unknown } }).user
      if (user && typeof user.name === 'string' && user.name.trim()) {
        lastActiveByDoc.set(documentName, user.name.trim().slice(0, 40))
      }
    }
  },
})

export function closeDocConnections(docId: string): void {
  try {
    hocuspocus.closeConnections(docId)
  } catch {
    // document may not be loaded
  }
  onlineByDoc.delete(docId)
}
