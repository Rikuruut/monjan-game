import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 撮影・合体のサーバー(../generator/)が /battle/ で配る。ビルドしたものはそのサーバーの static/battle/ に置く
  base: '/battle/',
  // npm run dev のときも、字体(/static/vendor/fonts/)は 8000 番のサーバーから借りる(なければ代わりの字体)
  server: {
    proxy: { '/static': 'http://localhost:8000' },
  },
  build: {
    outDir: '../generator/static/battle',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
