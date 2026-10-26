import express, { type NextFunction, type Request, type Response } from 'express'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crossws from 'crossws/adapters/node'
import multer from 'multer'
import { CLIENT_DIR, HOST, HOST_KEY, PORT } from './config.js'
import { closeDb, createDoc, getAssetByFilename, getDocMeta, listDocs, softDeleteDoc } from './db.js'
import { getOnlineCount, hocuspocus, closeDocConnections } from './collab.js'
import { getNetworkInfo } from './network.js'
import { isAssetFile, isDocId, makeDocId } from './ids.js'
import { saveAsset, upload } from './assets.js'
import { ASSETS_DIR } from './config.js'

const app = express()
app.disable('x-powered-by')
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss: data: blob:; font-src 'self' data:; base-uri 'none'; form-action 'self'",
  )
  next()
})
app.use(express.json({ limit: '2mb' }))

function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } })
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    docs: listDocs().length,
    connections: hocuspocus.getConnectionsCount(),
  })
})

app.get('/api/network', async (_req, res) => {
  res.json(await getNetworkInfo())
})

app.get('/api/docs', (req, res) => {
  const base = typeof req.query.base === 'string' ? req.query.base.replace(/\/+$/, '') : ''
  res.json({
    docs: listDocs().map((doc) => ({
      ...doc,
      online: getOnlineCount(doc.id),
      url: base ? `${base}/d/${doc.id}` : undefined,
    })),
  })
})

app.post('/api/docs', async (req, res) => {
  const title =
    typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '未命名文档'
  const id = makeDocId()
  const doc = createDoc(id, title)
  const network = await getNetworkInfo()
  res.status(201).json({
    ...doc,
    url: `${network.primary}/d/${id}`,
    online: 0,
  })
})

app.get('/api/docs/:id', async (req, res) => {
  if (!isDocId(req.params.id)) return fail(res, 404, 'NOT_FOUND', '文档不存在')
  const doc = getDocMeta(req.params.id)
  if (!doc) return fail(res, 404, 'NOT_FOUND', '文档不存在')
  const network = await getNetworkInfo()
  res.json({
    ...doc,
    online: getOnlineCount(doc.id),
    url: `${network.primary}/d/${doc.id}`,
  })
})

app.delete('/api/docs/:id', (req, res) => {
  if (req.header('x-host-key') !== HOST_KEY) {
    return fail(res, 403, 'FORBIDDEN', '需要主机密钥')
  }
  if (!isDocId(req.params.id)) return fail(res, 404, 'NOT_FOUND', '文档不存在')
  closeDocConnections(req.params.id)
  const deleted = softDeleteDoc(req.params.id)
  if (!deleted) return fail(res, 404, 'NOT_FOUND', '文档不存在')
  res.json({ ok: true })
})

app.post('/api/docs/:id/assets', upload.single('file'), (req, res, next) => {
  try {
    const docId = String(req.params.id)
    if (!isDocId(docId)) return fail(res, 404, 'NOT_FOUND', '文档不存在')
    const doc = getDocMeta(docId)
    if (!doc) return fail(res, 404, 'NOT_FOUND', '文档不存在')
    if (!req.file) return fail(res, 400, 'NO_FILE', '没有收到图片文件')
    const saved = saveAsset({
      docId,
      buffer: req.file.buffer,
      width: req.body?.width,
      height: req.body?.height,
    })
    res.status(201).json(saved)
  } catch (error) {
    next(error)
  }
})

app.get('/assets/:docId/:filename', (req, res) => {
  const { docId, filename } = req.params
  if (!isDocId(docId) || !isAssetFile(filename)) {
    return fail(res, 404, 'NOT_FOUND', '图片不存在')
  }
  const asset = getAssetByFilename(docId, filename)
  if (!asset) return fail(res, 404, 'NOT_FOUND', '图片不存在')

  const file = path.join(ASSETS_DIR, docId, filename)
  if (!fs.existsSync(file)) return fail(res, 404, 'NOT_FOUND', '图片不存在')

  res.setHeader('Content-Type', asset.mime)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  res.sendFile(file)
})

app.use('/api', (_req, res) => {
  fail(res, 404, 'NOT_FOUND', '接口不存在')
})

app.use('/assets', (_req, res) => {
  fail(res, 404, 'NOT_FOUND', '图片不存在')
})

if (fs.existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: '1h' }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/assets/')) {
      return next()
    }
    const index = path.join(CLIENT_DIR, 'index.html')
    if (!fs.existsSync(index)) return next()
    res.sendFile(index)
  })
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return fail(res, status, err.code, status === 413 ? '图片不能超过 15MB' : '图片上传失败')
  }
  const status =
    typeof err === 'object' && err && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500
  const message = err instanceof Error ? err.message : '服务器内部错误'
  if (status >= 500) console.error(err)
  fail(res, status, status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST', message)
})

const server = createServer(app)

const ws = crossws({
  hooks: {
    open(peer) {
      const connection = hocuspocus.handleConnection(
        peer.websocket as never,
        peer.request,
      )
      ;(peer as unknown as { _lanpadConnection?: typeof connection })._lanpadConnection =
        connection
      const raw = peer.websocket as unknown as {
        on?: (event: string, listener: () => void) => void
      }
      raw.on?.('pong', () => connection.touch())
    },
    message(peer, message) {
      const connection = (
        peer as unknown as { _lanpadConnection?: ReturnType<typeof hocuspocus.handleConnection> }
      )._lanpadConnection
      connection?.handleMessage(message.uint8Array())
    },
    close(peer, event) {
      const connection = (
        peer as unknown as { _lanpadConnection?: ReturnType<typeof hocuspocus.handleConnection> }
      )._lanpadConnection
      connection?.handleClose({ code: event.code ?? 1000, reason: event.reason ?? '' })
    },
    error(peer, error) {
      console.error('[ws]', peer.remoteAddress, error)
    },
  },
})

server.on('upgrade', (request, socket, head) => {
  if (!request.url?.startsWith('/collab')) {
    socket.destroy()
    return
  }
  ws.handleUpgrade(request, socket, head).catch((error) => {
    console.error('[ws-upgrade]', error)
    socket.destroy()
  })
})

server.listen(PORT, HOST, async () => {
  const network = await getNetworkInfo()
  console.log('')
  console.log('  LAN Pad · 队内题目协作')
  console.log(`  本机访问:   http://localhost:${PORT}`)
  console.log(`  局域网访问: ${network.primary}`)
  if (network.addresses.length > 1) {
    console.log('  检测到多个网卡:')
    for (const item of network.addresses) {
      console.log(`    - ${item.iface}: ${item.url}`)
    }
  }
  console.log('')
  console.log(`  主机密钥: ${HOST_KEY}`)
  console.log('  （删除文档等主机操作才需要，队友不用）')
  console.log('')
})

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[${signal}] 正在保存并退出...`)
  try {
    hocuspocus.flushPendingStores()
    hocuspocus.closeConnections()
  } catch (error) {
    console.error(error)
  }
  server.close(() => {
    closeDb()
    process.exit(0)
  })
  setTimeout(() => {
    closeDb()
    process.exit(0)
  }, 2500).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
