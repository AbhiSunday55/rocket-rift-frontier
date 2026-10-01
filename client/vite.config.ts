import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built bundle can be served from any static path
// (including the /sites/<project>/webpages/<name>/ artifact host).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
          web3: ['ethers'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
