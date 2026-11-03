// KERNEL · 手机访问（LAN）管理器
// 数据服务只监听 127.0.0.1；这里按需启动一个独立的 Vite 实例，监听 0.0.0.0:<port>，
// 让同一 WiFi 的手机通过前端代理访问 /api。停止时结束整个子进程树。

import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const START_TIMEOUT_MS = 20000

function lanAddresses() {
  const addresses = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address)
    }
  }
  return [...new Set(addresses)]
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '0.0.0.0', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('无法分配局域网端口'))))
    })
  })
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: '127.0.0.1', port })
      const finish = (ok) => {
        socket.destroy()
        if (ok) {
          resolve()
          return
        }
        if (Date.now() > deadline) {
          reject(new Error('Vite 启动超时（手机访问未开启）'))
          return
        }
        setTimeout(attempt, 200)
      }
      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
    }
    attempt()
  })
}

export function createLanManager({ root }) {
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const logPath = path.join(root, 'data', 'lan.log')

  let child = null
  let port = 0
  let urls = []
  let startedAt = null
  let starting = null

  const status = () => ({ running: child !== null, port, urls, startedAt })

  const stop = async () => {
    const current = child
    child = null
    port = 0
    urls = []
    startedAt = null
    if (current === null || current.pid === undefined) return status()
    await new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/F', '/T', '/PID', String(current.pid)], () => resolve())
        return
      }
      try {
        current.kill('SIGTERM')
      } catch {
        /* 进程可能已退出 */
      }
      resolve()
    })
    return status()
  }

  const start = async () => {
    if (child !== null) return status()
    if (starting !== null) return starting

    starting = (async () => {
      if (!fs.existsSync(viteBin)) throw new Error('未找到 Vite（请先运行 npm install）')
      const addresses = lanAddresses()
      if (addresses.length === 0) throw new Error('未找到局域网地址（请先连接 WiFi 或网线）')

      const nextPort = await freePort()
      fs.mkdirSync(path.dirname(logPath), { recursive: true })
      const logFd = fs.openSync(logPath, 'a')
      const proc = spawn(
        process.execPath,
        [viteBin, '--host', '0.0.0.0', '--port', String(nextPort), '--strictPort'],
        {
          cwd: root,
          env: { ...process.env, BROWSER: 'none' },
          stdio: ['ignore', logFd, logFd],
          windowsHide: true,
        },
      )
      fs.closeSync(logFd)

      child = proc
      port = nextPort
      startedAt = new Date().toISOString()
      proc.once('exit', () => {
        if (child !== proc) return
        child = null
        port = 0
        urls = []
        startedAt = null
      })

      try {
        await waitForPort(nextPort, START_TIMEOUT_MS)
      } catch (err) {
        await stop()
        throw err
      }
      if (child !== proc) {
        throw new Error('Vite 启动失败（端口被占用）')
      }

      urls = addresses.map((address) => `http://${address}:${nextPort}`)
      return status()
    })()

    try {
      return await starting
    } finally {
      starting = null
    }
  }

  process.once('exit', () => {
    if (child === null || child.pid === undefined) return
    try {
      child.kill()
    } catch {
      /* 进程可能已退出 */
    }
  })

  return { status, start, stop }
}
