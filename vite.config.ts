import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('@monaco-editor') || id.includes('monaco-editor')) {
              return 'editor';
            }

            if (id.includes('@webcontainer') || id.includes('xterm')) {
              return 'runtime';
            }

            if (id.includes('jszip') || id.includes('@stackblitz/sdk')) {
              return 'export-tools';
            }

            if (
              id.includes('react-dom') ||
              id.includes('react-router') ||
              id.includes('/react/')
            ) {
              return 'vendor-react';
            }

            if (
              id.includes('react-resizable-panels') ||
              id.includes('lucide-react') ||
              id.includes('/motion/')
            ) {
              return 'vendor-ui';
            }

            return undefined;
          },
        },
      },
    },
    server: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
