import { readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { run } from '../exec.js'
import type { Attempt, Compressor, Effort } from '../types.js'

// IJG 标准亮度量化表（顺序无关，只用总和）
const stdLuma = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80,
  62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98,
  112, 100, 103, 99,
].reduce((a, b) => a + b)

/** 由亮度量化表（DQT 中 id 为 0 的表）按 IJG 缩放公式反推质量，解析不到返回 undefined */
function estimateQuality(buf: Buffer): number | undefined {
  let i = 2
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1]
    if (marker === 0xda || marker === 0xd9) break
    const end = i + 2 + buf.readUInt16BE(i + 2)
    for (let p = i + 4; marker === 0xdb && p < end; ) {
      const wide = buf[p] >> 4
      const id = buf[p] & 15
      let sum = 0
      for (let k = 0; k < 64; k++) sum += wide ? buf.readUInt16BE(p + 1 + k * 2) : buf[p + 1 + k]
      if (id === 0) {
        const s = (sum * 100) / stdLuma
        return Math.round(s <= 100 ? (200 - s) / 2 : 5000 / s)
      }
      p += 1 + 64 * (wide + 1)
    }
    i = end
  }
}

/** 在 SOI（及 JFIF APP0）之后插入只含 Orientation 的最小 EXIF 段 */
function withOrientation(jpg: Buffer, o: number): Buffer {
  // "Exif\0\0" + 大端 TIFF 头 + 1 个 IFD 项（0x0112 SHORT）
  const body = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0])
  const at = jpg[3] === 0xe0 ? 4 + jpg.readUInt16BE(4) : 2
  return Buffer.concat([jpg.subarray(0, at), Buffer.from([0xff, 0xe1, 0, body.length + 2]), body, jpg.subarray(at)])
}

const distances: Record<Effort, string[]> = { fast: ['1.0'], balanced: ['1.0', '0.7'], max: ['1.5', '1.2', '1.0', '0.7'] }

export const jpeg: Compressor = async (src, effort) => {
  const { orientation = 1, space } = await sharp(src).metadata()
  const lossless: Attempt = {
    encoder: 'jpegtran',
    lossless: true,
    async run(out) {
      // 只保留 ICC；原有方向标记单独写回，避免显示方向出错
      await run('jpegtran', ['-copy', 'icc', '-optimize', '-progressive', '-outfile', out, src])
      if (orientation > 1) await writeFile(out, withOrientation(await readFile(out), orientation))
    },
  }
  const q = estimateQuality(await readFile(src))
  // 原图质量不高（重编码收益小且易劣化）或 CMYK 时只做无损优化
  if ((q !== undefined && q <= 75) || space === 'cmyk') return [lossless]

  // 转正方向并保留 ICC 的中间 PNG，各次尝试共用
  let png: Promise<string> | undefined
  const decode = (out: string) =>
    (png ??= sharp(src).rotate().keepIccProfile().png({ compressionLevel: 0 }).toFile(`${out}.src.png`).then(() => `${out}.src.png`))
  return [
    ...distances[effort].map(
      (d): Attempt => ({
        encoder: `cjpegli -d ${d}`,
        run: async (out) => void (await run('cjpegli', [await decode(out), out, '-d', d])),
      }),
    ),
    lossless,
  ]
}
