import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'

// `vite build --mode single` produit un unique fichier HTML autonome (publiable tel quel).
export default defineConfig(({ mode }) => ({
  root: 'web',
  base: './',
  // web/public : replays écrits par la CLI (`npm run sim`, web/public/replays/*.json + index.json lu par le
  // visualiseur) ; non copié dans la version « fichier unique ».
  publicDir: mode === 'single' ? false : 'public',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? '../dist-single' : '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
  },
}))
