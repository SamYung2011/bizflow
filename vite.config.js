import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // 主包原本 1.1MB 全挤一个 chunk：依赖库（基本不变）和 i18n 字典（常改）
        // 拆开后浏览器能分开缓存，改业务代码不再连带重新下载整包
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'supabase'
            if (id.includes('@tanstack')) return 'query'
            return 'vendor'
          }
          if (id.includes('/src/i18n.jsx')) return 'i18n'
        },
      },
    },
  },
})
