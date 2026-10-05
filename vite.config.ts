import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 解析 src 绝对路径：不依赖 node 类型（依赖白名单未含 @types/node）。
// Vite 以 ESM 加载本配置，import.meta.url 可用；Windows 盘符前导斜杠需去掉。
const srcPath = decodeURIComponent(new URL('./src', import.meta.url).pathname).replace(
  /^\/([A-Za-z]:)/,
  '$1',
)

// v0.4 数据服务（仅 127.0.0.1:4097）经由 Vite 代理接入，浏览器与手机都只访问一个入口。
const apiProxy = {
  '/api': 'http://127.0.0.1:4097',
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcPath,
    },
  },
  build: {
    // 路由级懒加载之上再拆分体积最大的第三方依赖，避免单入口包体过大（见 CHANGELOG 体验清扫）。
    // react / motion 被打包进入口（应用壳依赖），markdown 仅资料页按需载入。
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'motion-vendor': ['motion'],
          'markdown-vendor': ['react-markdown'],
        },
      },
    },
  },
  // dev / preview 默认仅本机（不暴露未鉴权的 /api 代理到局域网）；
  // 需要局域网 / 手机访问时显式 `npm run dev -- --host`。
  server: {
    host: false,
    proxy: apiProxy,
    // 数据服务写入 data/** 不再触发热重载（前端经 API hydrate 获取最新快照，避免写入后整页刷新打断撤销）
    watch: {
      ignored: ['**/data/**'],
    },
  },
  preview: {
    host: false,
    proxy: apiProxy,
  },
})
