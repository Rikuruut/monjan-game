import { defineConfig } from 'vitest/config';

// シミュレーション(npm.cmd run sim)だけを回す設定。ふだんのテスト(npm.cmd test)には入らない
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.sim.ts'],
    testTimeout: 600000,
  },
});
