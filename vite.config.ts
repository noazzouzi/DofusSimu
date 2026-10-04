import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

// `vite build --mode single` produit un unique fichier HTML autonome (publiable tel quel).
export default defineConfig(({ mode }) => ({
  root: 'web',
  base: './',
  publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? '../dist-single' : '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
  },
}))
