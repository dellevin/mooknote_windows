import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@main': resolve('src/main') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [vue()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            framework: ['vue', 'vue-router', 'pinia'],
            fluent: ['naive-ui']
          }
        }
      }
    }
  }
})
