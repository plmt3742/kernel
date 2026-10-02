import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 解析 src 绝对路径：不依赖 node 类型（依赖白名单未含 @types/node）。
// Vite 以 ESM 加载本配置，import.meta.url 可用；Windows 盘符前导斜杠需去掉。
const srcPath = decodeURIComponent(new URL('./src', import.meta.url).pathname).replace(
  /^\/([A-Za-z]:)/,
  '$1',
)

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcPath,
    },
  },
  // server.host / preview.host 开启以便局域网开箱即用（见 00-DESIGN-BRIEF §6.4）
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
