import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev proxy forwards API calls to the local backend; NEXAMIND_API points it at another one.
const API = process.env.NEXAMIND_API || 'http://127.0.0.1:8000';
const WS = API.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': API,
      '/workspaces': API,
      '/ai': API,
      '/ws': {
        target: WS,
        ws: true,
      },
      '/health': API,
      '/contact': API,
      '/notifications': API,
      '/git': API,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
