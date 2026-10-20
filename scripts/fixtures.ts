// 测试集只有 PNG：从中挑较大的图生成其他格式的样例，输出到 bench/fixtures/<格式>/
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { join, parse } from 'node:path'
import sharp from 'sharp'

const src = process.argv[2] ?? 'img'
const out = 'bench/fixtures'

async function pngs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries.filter((e) => e.isFile() && e.name.endsWith('.png')).map((e) => join(e.parentPath, e.name))
}

const all = await pngs(src)
const sized = await Promise.all(all.map(async (p) => ({ p, size: (await stat(p)).size })))
const picks = sized.filter((f) => f.size > 30 * 1024).sort((a, b) => b.size - a.size).slice(0, 12).map((f) => f.p)
const name = (p: string) => parse(p).dir.replace(/[\\/]/g, '_') + '_' + parse(p).name

for (const d of ['jpeg', 'webp', 'avif', 'gif', 'svg']) await mkdir(join(out, d), { recursive: true })

for (const p of picks) {
  const n = name(p)
  const img = () => sharp(p)
  const flat = () => img().flatten({ background: '#ffffff' })
  await flat().jpeg({ quality: 95 }).toFile(join(out, 'jpeg', `${n}-q95.jpg`))
  await flat().jpeg({ quality: 70 }).toFile(join(out, 'jpeg', `${n}-q70.jpg`))
  await img().webp({ quality: 95 }).toFile(join(out, 'webp', `${n}-lossy.webp`))
  await img().webp({ lossless: true }).toFile(join(out, 'webp', `${n}-lossless.webp`))
  await img().avif({ quality: 90 }).toFile(join(out, 'avif', `${n}.avif`))
  await img().gif().toFile(join(out, 'gif', `${n}.gif`))
}

// 动图：用前 6 张同尺寸的图拼成动画
const frames = await Promise.all(picks.slice(0, 6).map((p) => sharp(p).resize(400, 400, { fit: 'contain' }).png().toBuffer()))
await sharp(frames, { join: { animated: true } }).gif({ delay: 200, loop: 0 }).toFile(join(out, 'gif', 'animated.gif'))

// SVG：格式冗余（多余空白、注释、默认属性、高精度坐标），模拟设计工具导出
for (let k = 0; k < 3; k++) {
  const shapes = Array.from({ length: 120 }, (_, i) => {
    const x = (Math.sin(i + k) * 200 + 250).toFixed(6)
    const y = (Math.cos(i * 1.3 + k) * 200 + 250).toFixed(6)
    return `  <!-- shape ${i} -->\n  <g id="group-${i}" fill-opacity="1" stroke-width="1">\n    <path d="M ${x} ${y} L ${(+x + 20).toFixed(6)} ${y} L ${x} ${(+y + 20).toFixed(6)} Z" fill="#${((i * 9973) & 0xffffff).toString(16).padStart(6, '0')}" stroke="none"/>\n  </g>`
  }).join('\n')
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Generator: Design Tool -->\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="500" height="500" viewBox="0 0 500 500">\n  <title>sample ${k}</title>\n  <metadata>exported</metadata>\n${shapes}\n</svg>\n`
  await writeFile(join(out, 'svg', `sample-${k}.svg`), doc)
}

console.log(`从 ${picks.length} 张 PNG 生成样例到 ${out}/`)
