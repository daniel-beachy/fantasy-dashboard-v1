import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'cloud' ? '/' : process.env.GITHUB_ACTIONS ? '/fantasy-dashboard-v1/' : '/',
  define: { 'import.meta.env.VITE_CLOUD_HOSTED': JSON.stringify(mode === 'cloud') },
}));
