import { readFile, rm } from 'node:fs/promises'
import sharp from 'sharp'
import { run } from '../exec.js'
import type { Compressor, Effort } from '../types.js'

interface Info {
  depth: number
  yuv: string
  /** nclx 的 P/T/M，无 ICC 时沿用 */
  cicp?: string
  range?: string
}

/** 从 av1C/colr 盒读取位深、色度采样与 nclx；alpha 辅助图是单色的，取第一个非单色 av1C */
function avifInfo(buf: Buffer): Info | undefined {
  let info: Info | undefined
  for (let i = buf.indexOf('av1C'); i >= 0 && i + 7 < buf.length; i = buf.indexOf('av1C', i + 4)) {
    const b = buf[i + 6]
    const mono = (b >> 4) & 1
    const yuv = mono ? '400' : (b >> 3) & 1 ? ((b >> 2) & 1 ? '420' : '422') : '444'
    info = { depth: (b >> 6) & 1 ? ((b >> 5) & 1 ? 12 : 10) : 8, yuv }
    if (!mono) break
  }
  const c = buf.indexOf('colrnclx')
  if (info && c >= 0 && c + 14 < buf.length) {
    info.cicp = [0, 2, 4].map((o) => buf.readUInt16BE(c + 8 + o)).join('/')
    info.range = buf[c + 14] >> 7 ? 'full' : 'limited'
  }
  return info
}

// 固定质量（UI 图实测 s6 下 q74 全部 ≥85）；fast 不做判定且 s8 画质略差，取更保守的 q78；
// max 从更低的质量开始，首个通过判定即为结果
const qs: Record<Effort, number[]> = { fast: [78], balanced: [74], max: [66, 70, 74] }
const speed: Record<Effort, string> = { fast: '8', balanced: '6', max: '4' }

export const avif: Compressor = async (src, effort) => {
  const buf = await readFile(src)
  const info = avifInfo(buf)
  // 动图（ftyp 中含 avis）暂不处理，sharp 也无法解码
  if (!info || buf.subarray(0, buf.readUInt32BE(0)).includes('avis')) return []
  const hasIcc = !!(await sharp(src).metadata().catch(() => undefined))?.icc
  return qs[effort].map((q) => ({
    encoder: `avifenc q${q}`,
    run: async (out: string) => {
      // avifenc 只读 PNG/JPEG/Y4M，先用 sharp 解码；高位深走 16-bit PNG，保留 ICC
      const png = `${out}.src.png`
      let img = sharp(src, { limitInputPixels: false }).keepIccProfile()
      if (info.depth > 8) img = img.toColourspace(info.yuv === '400' ? 'grey16' : 'rgb16')
      await img.png({ compressionLevel: 0 }).toFile(png)
      try {
        // -j 1：调度器已按文件并发占满 CPU
        const args = ['-j', '1', '-q', String(q), '-s', speed[effort], '-d', String(info.depth), '-y', info.yuv]
        // 不用 --sharpyuv：源已是 420 时它反而偏离源解码结果（实测 SSIMULACRA2 掉约 8 分）
        args.push('-a', 'tune=iq', '--ignore-exif', '--ignore-xmp')
        if (info.cicp && !hasIcc) args.push('--cicp', info.cicp, '-r', info.range!)
        await run('avifenc', [...args, png, out])
      } finally {
        await rm(png, { force: true })
      }
    },
  }))
}
