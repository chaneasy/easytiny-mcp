import { readFile } from 'node:fs/promises'
import { run } from '../exec.js'
import type { Attempt, Compressor, Effort } from '../types.js'

type Kind = 'lossy' | 'lossless' | 'animated'

/** 读 RIFF 头判断编码类型；VP8X 扩展格式需扫描子块 */
function webpKind(buf: Buffer): Kind | undefined {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return
  for (let p = 12; p + 8 <= buf.length; p += 8 + buf.readUInt32LE(p + 4) + (buf.readUInt32LE(p + 4) & 1)) {
    const tag = buf.toString('latin1', p, p + 4)
    if (tag === 'VP8 ') return 'lossy'
    if (tag === 'VP8L') return 'lossless'
    if (tag === 'ANIM' || tag === 'ANMF' || (tag === 'VP8X' && buf[p + 8] & 0x02)) return 'animated'
  }
}

// 保留 ICC，丢弃 EXIF/XMP；透明通道无损编码（alpha_q 100）。不加 -exact：全透明像素的 RGB 不可见，交给编码器清理更省
const common = ['-quiet', '-metadata', 'icc', '-alpha_q', '100']

const attempt = (src: string, encoder: string, flags: string[], lossless = false): Attempt => ({
  encoder,
  lossless,
  run: async (out) => void (await run('cwebp', [...common, ...flags, src, '-o', out])),
})

// 有损源 q90 实测全部 ≥85；max 从更激进的参数开始逐级放宽，首个通过判定的即为搜索结果
const lossyQ: Record<Effort, number[]> = { fast: [90, 93], balanced: [90, 93], max: [86, 88, 90, 93] }
const nearLossless: Record<Effort, number[]> = { fast: [60], balanced: [60], max: [40, 60, 80] }

export const webp: Compressor = async (src, effort) => {
  const kind = webpKind(await readFile(src))
  const max = effort === 'max'
  if (kind === 'lossy') {
    const m = ['-m', max ? '6' : '4']
    // 源已是 420，不加 -sharp_yuv：实测同 q 下体积相近、分数反而低约 0.5
    return lossyQ[effort].map((q) => attempt(src, `cwebp q${q}`, ['-q', String(q), ...m]))
  }
  if (kind === 'lossless') {
    const z = max ? '9' : '6'
    return [
      ...nearLossless[effort].map((n) => attempt(src, `cwebp near_lossless${n}`, ['-near_lossless', String(n), '-z', z])),
      attempt(src, 'cwebp lossless', ['-lossless', '-z', z], true),
    ]
  }
  return []
}
