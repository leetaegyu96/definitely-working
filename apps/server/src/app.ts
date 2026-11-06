import type { ClientToServerEvents, ServerToClientEvents } from '@relay/shared'
import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from 'socket.io'
import { config } from './config.js'
import { RoomManager } from './rooms/RoomManager.js'
import { realClock, type Clock } from './services/clock.js'
import { createBroadcaster, registerSocketHandlers } from './socket/handlers.js'

export function createApp(opts: { clock?: Clock; serveStatic?: boolean } = {}) {
  const app = express()
  app.disable('x-powered-by')
  const httpServer = createServer(app)
  const base = config.basePath
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: `${base}socket.io`,
    cors: { origin: config.corsOrigin },
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  })
  const rooms = new RoomManager(opts.clock ?? realClock, createBroadcaster(io))
  registerSocketHandlers(io, rooms)

  app.get(`${base}healthz`, (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size, sockets: io.engine.clientsCount })
  })

  if (opts.serveStatic) {
    const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
    if (existsSync(dist)) {
      const router = express.Router()
      router.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '30d' }))
      router.use(express.static(dist, { index: false, maxAge: '1h' }))
      // SPA fallback (s/CODE 초대 링크 포함) — index.html 은 캐시하지 않음
      router.get('*', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html')))
      if (base !== '/')
        app.use((req, res, next) => (req.path === base.slice(0, -1) ? res.redirect(301, base) : next()))
      app.use(base, router)
    } else {
      console.warn(`[server] web build not found at ${dist} — run "npm run build" first`)
    }
  }

  return { app, httpServer, io, rooms }
}
