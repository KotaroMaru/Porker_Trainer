import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PokerTrainer',
        short_name: 'PokerTrainer',
        description: 'ポーカートレーナー - セブキャッシュゲーム向けアドバイザー',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f2a1a',
        theme_color: '#1c2e23',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // P6 Step B11: GTO解データ(public/gto/solutions/)はビルド成果物ではなくバッチ生成
        // (tools/solver/precompute)が出力する大量の.binファイルなのでglobPatternsの対象に
        // 含めず、実行時キャッシュで扱う。.binは一度取得すれば内容が変わらない(フロップ+
        // シナリオで一意)のでCacheFirst。manifest.jsonはバッチ生成の進捗(--resumeで
        // 追記され続ける)を反映する必要があるため、CacheFirstだと進捗が最大30日固まって
        // しまう — StaleWhileRevalidateで都度リクエストしつつ即座にキャッシュ内容も返す。
        runtimeCaching: [
          {
            urlPattern: /\/gto\/solutions\/.*\.bin$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gto-solutions',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/gto\/solutions\/.*\/manifest\.json$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'gto-manifests',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
