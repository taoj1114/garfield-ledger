import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    alias: {
      react: '@preact/compat',
      'react-dom': '@preact/compat',
      'react-dom/test-utils': '@preact/compat',
      'react/jsx-runtime': '@preact/compat/jsx-runtime',
    },
  },
});
