import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@boardbot/shared': path.resolve(__dirname, '../shared/types.ts'),
    },
  },
  server: {
    port: 5173,
    host: true, // Accept external connections
    allowedHosts: 'all',
    proxy: {
      '/api': 'http://localhost:3001',
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
