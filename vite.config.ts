import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Served from a project page on GitHub Pages, so assets need the repo prefix.
  base: process.env.GITHUB_PAGES === 'true' ? '/rapid_modbus/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'rapid_modbus — Modbus master',
        short_name: 'rapid_modbus',
        description:
          'Modbus RTU/ASCII master over Web Serial. No install, no backend, works offline.',
        theme_color: '#0369a1',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'any',
        categories: ['utilities', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Field sites have no internet, so everything the app needs is
        // precached — there is no network to fall back to.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
      devOptions: {
        // Keep the service worker out of the way during development.
        enabled: false,
      },
    }),
  ],
})
