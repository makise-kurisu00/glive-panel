import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api.php': {
        target: 'https://www.glivestreaming.com',
        changeOrigin: true,
        secure: true,
      },
      '/h5link': {
        target: 'https://www.glivestreaming.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
