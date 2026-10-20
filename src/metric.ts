import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { run, which } from './exec.js'

// libvips 缓存会一直占用读过的文件，Windows 上会导致原图无法替换、临时文件无法删除
sharp.cache(false)

/** 解码为 sRGB PNG（自动校正方向）；有透明通道时合成到 bg 背景上 */
async function toPng(file: string, out: string, page: number, density: number, bg?: string): Promise<string> {
  let img = sharp(file, { page, density, limitInputPixels: false }).rotate()
  if (bg) img = img.flatten({ background: bg })
  await img.png({ compressionLevel: 0 }).toFile(out)
  return out
}

/** 兼容 libjxl 的 ssimulacra2 与 Rust 版 ssimulacra2_rs */
async function ssimulacra2(a: string, b: string): Promise<number> {
  let stdout: string
  try {
    which('ssimulacra2')
    stdout = await run('ssimulacra2', [a, b])
  } catch {
    stdout = await run('ssimulacra2_rs', ['image', a, b])
  }
  const m = stdout.trim().match(/-?\d+(\.\d+)?$/)
  if (!m) throw new Error(`无法解析 SSIMULACRA2 输出: ${stdout}`)
  return Number(m[0])
}

/**
 * 计算 SSIMULACRA2 分数（越高越好，≥85 视为视觉无损）。
 * 透明图分别合成到黑、白底取较差值；动图抽首、中、尾三帧取最低值。
 * 原图解码结果以 refBase 为前缀缓存，同一文件的多次尝试共用。
 */
export async function score(orig: string, cand: string, refBase: string): Promise<number> {
  const { pages = 1, hasAlpha, format, width = 0, height = 0 } = await sharp(orig).metadata()
  // 矢量图按长边约 512px 渲染：太小的图标无法计算，也看不出瑕疵
  const density = format === 'svg' ? 72 * Math.min(Math.max(512 / Math.max(width, height, 1), 1), 32) : 72
  const frames = [...new Set([0, pages >> 1, pages - 1])]
  const bgs = hasAlpha ? ['#000000', '#ffffff'] : [undefined]
  let min = Infinity
  for (const page of frames) {
    for (const [i, bg] of bgs.entries()) {
      const ref = `${refBase}.ref${page}-${i}.png`
      const a = existsSync(ref) ? ref : await toPng(orig, ref, page, density, bg)
      const b = await toPng(cand, `${cand}.cmp${page}-${i}.png`, page, density, bg)
      min = Math.min(min, await ssimulacra2(a, b))
    }
  }
  return min
}
