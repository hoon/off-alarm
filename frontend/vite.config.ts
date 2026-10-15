import { defineConfig, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { mockButtonEvents } from './src/mockButtonEvents'
import { mockAlarmEvents } from './src/mockAlarmEvents'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(mode === 'mock'
        ? [
            {
              name: 'mock-api',
              configureServer(server: ViteDevServer) {
                const alarmSettings = { enabled: true, toleranceMinutes: 10 }

                server.middlewares.use(async (req, res, next) => {
                  if (req.url === '/api/v1/sleep-position-alarm') {
                    res.setHeader('Content-Type', 'application/json')
                    if (req.method === 'POST') {
                      try {
                        let body = ''
                        for await (const chunk of req) {
                          body += chunk.toString()
                        }
                        const data = JSON.parse(body)
                        if (typeof data.enabled === 'boolean') {
                          alarmSettings.enabled = data.enabled
                        }
                        if (
                          typeof data.toleranceMinutes === 'number' &&
                          data.toleranceMinutes > 0
                        ) {
                          alarmSettings.toleranceMinutes = data.toleranceMinutes
                        }
                      } catch {
                        res.statusCode = 400
                        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
                        return
                      }
                    } else if (req.method !== 'GET') {
                      res.statusCode = 405
                      res.setHeader('Allow', 'GET, POST')
                      res.end(JSON.stringify({ error: 'Method not allowed' }))
                      return
                    }
                    res.end(JSON.stringify(alarmSettings))
                    return
                  }
                  if (req.url === '/api/v1/button-events') {
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(mockButtonEvents))
                    return
                  }
                  if (req.url === '/api/v1/alarm-events') {
                    res.setHeader('Content-Type', 'application/json')
                    res.end(JSON.stringify(mockAlarmEvents))
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
