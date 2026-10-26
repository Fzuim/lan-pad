import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import WebSocket from 'ws'

const docId = process.argv[2]
const url = process.env.WS_URL || 'ws://127.0.0.1:8787/collab'
const doc = new Y.Doc()
let resolveSynced
const synced = new Promise((resolve) => {
  resolveSynced = resolve
})
const provider = new HocuspocusProvider({
  url,
  name: docId,
  document: doc,
  WebSocketPolyfill: WebSocket,
  onSynced: ({ state }) => state && resolveSynced(),
})

await Promise.race([
  synced,
  new Promise((_, reject) => setTimeout(() => reject(new Error('sync timeout')), 8000)),
])
console.log('probe:', JSON.stringify(doc.getText('probe').toString()))
console.log('title:', JSON.stringify(doc.getText('title').toString()))
provider.destroy()
doc.destroy()
setTimeout(() => process.exit(0), 100)
