import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Cloudflare's Rocket Loader rewrites <script> tags and breaks ES modules / service worker registration. This attribute opts the app's scripts out. */
const noRocketLoader = (): Plugin => ({
  name: 'no-rocket-loader',
  transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<script(?![^>]*data-cfasync)/g, '<script data-cfasync="false"') },
});

export default defineConfig({
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    noRocketLoader(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Workspace OS',
        short_name: 'Workspace',
        description: 'Self-hosted tasks and a unified read-only calendar.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#1c1c1e',
        theme_color: '#1c1c1e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the app icon (Android / desktop) for these.
        shortcuts: [
          { name: 'Add task', short_name: 'Add task', url: '/?add=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Today', short_name: 'Today', url: '/today', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
    }),
  ],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:3000', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
