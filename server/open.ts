import { spawn } from 'node:child_process'

/**
 * 双击 exe 启动后自动打开浏览器；LANPAD_OPEN=0 可关闭。
 */
export function openBrowser(url: string): void {
  try {
    const child =
      process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', url], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
          })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
            detached: true,
            stdio: 'ignore',
          })
    child.on('error', () => {
      // 打不开浏览器不影响服务本身
    })
    child.unref()
  } catch {
    // ignore
  }
}
