import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from a project page on GitHub Pages, so assets need the repo prefix.
  base: process.env.GITHUB_PAGES === 'true' ? '/rapid_modbus/' : '/',
  plugins: [react(), tailwindcss()],
})
