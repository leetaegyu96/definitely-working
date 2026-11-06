import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WSL 에서 /mnt/c 같은 Windows 드라이브에 프로젝트가 있으면 inotify 가 동작하지 않아 polling 필요
const onWindowsMount = process.cwd().startsWith('/mnt/')

// 하위 경로 배포: BASE_PATH=/definitely-working/ npm run build
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    watch: onWindowsMount ? { usePolling: true, interval: 300 } : undefined,
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
})
