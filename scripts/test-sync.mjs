import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import WebSocket from 'ws'

const docId = process.argv[2]
if (!docId) {
  console.error('usage: node scripts/test-sync.mjs <docId>')
  process.exit(1)
}

const url = process.env.WS_URL || 'ws://127.0.0.1:8787/collab'

function connect(name) {
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
    onSynced: ({ state }) => {
      if (state) resolveSynced()
    },
    onStatus: ({ status }) => console.log(name, 'status', status),
  })
  return { doc, provider, synced }
}

const a = connect('A')
const b = connect('B')

await Promise.all([a.synced, b.synced])
console.log('both synced')

a.doc.getText('probe').insert(0, 'hello-from-a')
await new Promise((resolve) => setTimeout(resolve, 500))

const received = b.doc.getText('probe').toString()
console.log('B received:', JSON.stringify(received))
if (received !== 'hello-from-a') {
  console.error('SYNC FAILED')
  process.exitCode = 1
} else {
  console.log('SYNC OK')
}

b.doc.getText('probe').insert(0, 'b-')
await new Promise((resolve) => setTimeout(resolve, 500))
const back = a.doc.getText('probe').toString()
console.log('A received:', JSON.stringify(back))
if (back !== 'b-hello-from-a') {
  console.error('REVERSE SYNC FAILED')
  process.exitCode = 1
}

a.provider.destroy()
b.provider.destroy()
a.doc.destroy()
b.doc.destroy()
setTimeout(() => process.exit(process.exitCode || 0), 200)
