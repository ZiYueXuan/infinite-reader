import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_API = 'http://127.0.0.1:8787'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_PROXY || DEFAULT_API
  return {
    plugins: [react()],
    build: { manifest: true, rolldownOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      licenses: fileURLToPath(new URL('./fonts/licenses.html', import.meta.url)),
    } } },
    server: {
      // `/api` is proxied so the cookie session stays same-origin. The Worker rejects cross-origin writes
      // (403 bad_origin), so the Origin header is rewritten to the target's.
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (req) => {
              if (req.getHeader('origin')) req.setHeader('origin', new URL(target).origin)
            })
          },
        },
      },
    },
  }
})
