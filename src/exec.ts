import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const exe = process.platform === 'win32' ? '.exe' : ''
// 本地编译的编码器（src/ 与 dist/ 都在项目根目录下一层）
const vendorDir = fileURLToPath(new URL('../vendor/bin', import.meta.url))
// mozjpeg、jpeg-xl 在 Homebrew 中是 keg-only，优先于 PATH 中 libjpeg-turbo 的同名工具
const kegDirs = ['mozjpeg', 'jpeg-xl'].flatMap((f) => [`/opt/homebrew/opt/${f}/bin`, `/usr/local/opt/${f}/bin`])
const found = new Map<string, string>()

/** 查找顺序：EASYTINY_BIN_DIR → vendor/bin → Homebrew keg → PATH */
export function which(name: string): string {
  const cached = found.get(name)
  if (cached) return cached
  const dirs = [process.env.EASYTINY_BIN_DIR, vendorDir, ...kegDirs, ...(process.env.PATH ?? '').split(delimiter)]
  for (const dir of dirs) {
    const p = dir && join(dir, name + exe)
    if (p && existsSync(p)) {
      found.set(name, p)
      return p
    }
  }
  throw new Error(`找不到 ${name}，请安装或设置 EASYTINY_BIN_DIR`)
}

export async function run(name: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(which(name), args, { maxBuffer: 64 << 20 })
  return stdout
}
