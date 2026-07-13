import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 正门对调:老 bizflow 整站挂 /task-platform/ 旧入口,站根由 root-site/(新任务平台)接管。
  // 整站拼装看 scripts/build-front-door.mjs;publicDir 关掉,root-site/ 由拼装脚本拷进 dist 根。
  base: '/task-platform/',
  publicDir: false,
  build: {
    outDir: 'dist/task-platform',
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
