import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 小轩音乐管理端：竖屏轻量应用，同源连接 music.jrr.lol
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: false,

    chunkSizeWarningLimit: 2000,
  },
});
