import { defineConfig, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { mockButtonEvents } from './src/mockButtonEvents'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(),
      ...(mode === 'mock'
        ? [
            {
              name: 'mock-api',
              configureServer(server: ViteDevServer) {
                server.middlewares.use((req, res, next) => {
                  if (req.url === '/api/v1/button-events') {
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(mockButtonEvents))
                    return
                  }
                  next()
                })
              },
            },
          ]
        : []),
    ],
  }
})
