import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { fileURLToPath } from 'node:url'
import { stuffsPlugin } from './web/plugins/stuffs'
import { theoryPlugin } from './web/plugins/theory'

// `vite build --mode single` produit un unique fichier HTML autonome (publiable tel quel).
export default defineConfig(({ mode }) => ({
  root: 'web',
  base: './',
  // web/public : replays écrits par la CLI (`npm run sim`, web/public/replays/*.json + index.json lu par le
  // visualiseur) ; non copié dans la version « fichier unique ».
  publicDir: mode === 'single' ? false : 'public',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // stuffsPlugin : module virtuel des fiches de stuff des équipes (section « Stuffs », web/plugins/stuffs.ts) ;
  // theoryPlugin : API de la section « Boss » (serveur de développement seulement, web/plugins/theory.ts). Les deux
  // partagent les données du jeu (web/plugins/store.ts).
  plugins: mode === 'single' ? [stuffsPlugin(), theoryPlugin(), viteSingleFile()] : [stuffsPlugin(), theoryPlugin()],
  build: {
    outDir: mode === 'single' ? '../dist-single' : '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
  },
}))
