import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': 'http://127.0.0.1:8000',
      '/workspaces': 'http://127.0.0.1:8000',
      '/ai': 'http://127.0.0.1:8000',
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
      '/health': 'http://127.0.0.1:8000',
      '/contact': 'http://127.0.0.1:8000',
      '/notifications': 'http://127.0.0.1:8000',
      '/git': 'http://127.0.0.1:8000',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
