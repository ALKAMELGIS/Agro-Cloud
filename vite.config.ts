import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, gzip } from 'node:zlib'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { appConfig } from './config/app'

const gzipAsync = promisify(gzip)
const brotliAsync = promisify(brotliCompress)

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.wasm',
  '.xml',
])

function buildCompressionPlugin(): Plugin {
  let config: ResolvedConfig

  const walk = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = await Promise.all(
      entries.map((entry) => {
        const fullPath = join(dir, entry.name)
        return entry.isDirectory() ? walk(fullPath) : Promise.resolve([fullPath])
      }),
    )
    return files.flat()
  }

  return {
    name: 'agrocloud-compression',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    async closeBundle() {
      const outDir = isAbsolute(config.build.outDir) ? config.build.outDir : join(config.root, config.build.outDir)
      if (!existsSync(outDir)) return
      const files = await walk(outDir)
      await Promise.all(
        files
          .filter((file) => COMPRESSIBLE_EXTENSIONS.has(extname(file)) && !file.endsWith('.gz') && !file.endsWith('.br'))
          .map(async (file) => {
            const content = await readFile(file)
            if (content.byteLength < 10240) return
            const [gzipped, brotlied] = await Promise.all([gzipAsync(content), brotliAsync(content)])
            await Promise.all([writeFile(`${file}.gz`, gzipped), writeFile(`${file}.br`, brotlied)])
          }),
      )
    },
  }
}

export default defineConfig({
  base: appConfig.basePath,
  build: {
    chunkSizeWarningLimit: 1800,
    modulePreload: {
      polyfill: false,
    },
  },
  plugins: [
    react(),
    ...(process.env.ENABLE_PWA === 'true'
      ? [
          VitePWA({
            registerType: 'autoUpdate',
            injectRegister: null,
            devOptions: { enabled: false },
            includeAssets: ['favicon.ico', 'avatars/*.svg'],
            manifest: {
              name: 'Agri Cloud System',
              short_name: 'AgriCloud',
              description: 'Agricultural Management and Satellite Analysis System',
              theme_color: '#ffffff',
              icons: [
                {
                  src: 'avatars/emirati-farmer.svg',
                  sizes: '192x192',
                  type: 'image/svg+xml'
                },
                {
                  src: 'avatars/emirati-farmer.svg',
                  sizes: '512x512',
                  type: 'image/svg+xml'
                }
              ]
            }
          })
        ]
      : []),
    buildCompressionPlugin()
  ],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'server/**/*.{test,spec}.{js,ts}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**']
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3002',
        ws: true
      }
    }
  },
  preview: {
    port: 5173,
    host: true,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  }
})
