import { defineConfig } from 'vite'

export default defineConfig({
  base: '/SSNNSS/',
  server: { host: '127.0.0.1', port: 5173 },
  build: { rollupOptions: { input: 'src/main.tsx', output: { entryFileNames: 'deploy/app.js', assetFileNames: 'deploy/app[extname]' } } },
})
