import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { compressFile, defaults } from '../src/compress.js'

let dir: string

// 每种格式（及 WebP 的有损/无损分支）各一张样例，确认对应编码器在当前平台可用且结果通过判定
const samples: Record<string, (file: string) => Promise<unknown>> = {
  'photo.jpg': (f) => sharp('img/bg.png').jpeg({ quality: 95 }).toFile(f),
  'bg.png': (f) => sharp('img/bg.png').toFile(f),
  'lossy.webp': (f) => sharp('img/bg.png').webp({ quality: 95 }).toFile(f),
  'lossless.webp': (f) => sharp('img/illustration.png').webp({ lossless: true }).toFile(f),
  'bg.avif': (f) => sharp('img/bg.png').avif({ quality: 90 }).toFile(f),
  'bg.gif': (f) => sharp('img/bg.png').gif({ dither: 0 }).toFile(f),
  'icon.svg': (f) =>
    writeFile(
      f,
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported -->\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="200" height="200" viewBox="0 0 200 200">\n` +
        Array.from({ length: 300 }, (_, i) => `  <g id="g${i}" fill-opacity="1"><rect x="${(i % 20) * 10}.000000" y="${Math.floor(i / 20) * 10}.000000" width="8.000000" height="8.000000" fill="#${(i * 4099).toString(16).slice(-6).padStart(6, '0')}"/></g>`).join('\n') +
        '\n</svg>\n',
    ),
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'easytiny-codec-'))
  for (const [name, make] of Object.entries(samples)) await make(join(dir, name))
})

afterAll(() => rm(dir, { recursive: true, force: true }))

test.each(Object.keys(samples))('%s', async (name) => {
  const r = await compressFile(join(dir, name), dir, { ...defaults, minSize: 0 })
  expect(r.reason).toBeUndefined()
  expect(r.newSize).toBeLessThan(r.size)
}, 60_000)
