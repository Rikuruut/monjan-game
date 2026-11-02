import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 撮影・合体のサーバー(../generator/)が /battle/ で配る。ビルドしたものはそのサーバーの static/battle/ に置く
  base: '/battle/',
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
