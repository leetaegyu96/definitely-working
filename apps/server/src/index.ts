import { createApp } from './app.js'
import { config } from './config.js'

const isProd = process.env.NODE_ENV === 'production'
const { httpServer, rooms } = createApp({ serveStatic: isProd })
rooms.startSweeping()

httpServer.listen(config.port, () => {
  console.log(`[server] listening on :${config.port} (${isProd ? 'production' : 'development'})`)
})

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    rooms.stop()
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
