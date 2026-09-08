import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In sviluppo locale (npm run dev) inoltra le chiamate API al backend Node.js
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      // e i grafici statici al microservizio Python
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
});
