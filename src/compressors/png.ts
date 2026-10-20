import sharp from 'sharp'
import { run } from '../exec.js'
import type { Attempt, Compressor, Effort } from '../types.js'

interface Plan {
  oxipng: string[]
  /** pngquant 质量区间，依次尝试 */
  quant: string[]
  /** 真彩色截低位的步长，依次尝试 */
  posterize: number[]
}

// fast 不做 SSIMULACRA2 判定：pngquant 下限提到 85，截低位只用最保守的步长 2
// 上限 98 而非 95：95 会让渐变大背景少用颜色，判定不过而退回无损
// max 不用 zopfli：每次尝试都要跑，耗时翻数倍而体积几乎不变
const plans: Record<Effort, Plan> = {
  fast: { oxipng: ['-o', '1'], quant: ['85-98'], posterize: [2] },
  balanced: { oxipng: ['-o', '2'], quant: ['80-98'], posterize: [4, 2] },
  max: { oxipng: ['-o', '4'], quant: ['65-90', '80-98'], posterize: [8, 4, 2] },
}

// --strip safe 保留 sRGB/gAMA/cHRM 等色彩块（sRGB 的 iCCP 会被换成 sRGB 块），去掉文本与 EXIF
async function oxipng(effort: Effort, input: string, out: string): Promise<void> {
  await run('oxipng', [...plans[effort].oxipng, '--alpha', '--strip', 'safe', '--threads', '1', '--out', out, '--', input])
}

async function pngquant(src: string, out: string, quality: string): Promise<void> {
  try {
    // 带 ICC 时 pngquant 会转换到 sRGB 并写入 sRGB 块
    await run('pngquant', ['--quality', quality, '--speed', '3', '--force', '--output', out, '--', src])
  } catch (e) {
    if ((e as { code?: number }).code === 99) throw new Error(`达不到质量下限 ${quality}`)
    throw e
  }
}

// 调色板放不下的渐变插画：保持真彩色，各通道取 step 的倍数，滤波后 deflate 更省
// alpha 用半步长：半透明渐变在深色底上对 alpha 台阶更敏感
async function posterize(src: string, out: string, step: number): Promise<void> {
  const { data, info } = await sharp(src, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  for (let i = 0; i < data.length; i++) {
    const k = i % ch === ch - 1 ? step >> 1 : step
    data[i] = Math.min(255, Math.round(data[i] / k) * k)
  }
  await sharp(data, { raw: info }).png({ compressionLevel: 0 }).toFile(out)
}

export const png: Compressor = async (src, effort) => {
  const { quant, posterize: steps } = plans[effort]
  const lossy = (encoder: string, prep: (out: string) => Promise<void>): Attempt => ({
    encoder,
    async run(out) {
      await prep(out)
      await oxipng(effort, out, out)
    },
  })
  return [
    ...quant.map((q) => lossy(`pngquant ${q}+oxipng`, (out) => pngquant(src, out, q))),
    ...steps.map((s) => lossy(`posterize${s}+oxipng`, (out) => posterize(src, out, s))),
    { encoder: 'oxipng', lossless: true, run: (out) => oxipng(effort, src, out) },
  ]
}
