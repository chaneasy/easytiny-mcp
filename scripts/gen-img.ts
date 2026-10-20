// 生成 img/ 下的测试图片：模拟活动页 UI 素材（渐变背景、手绘质感插画、半透明面板、按钮、小图标）
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const out = 'img'
await mkdir(`${out}/icons`, { recursive: true })

const svg = (w: number, h: number, body: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)

// 用固定种子的伪随机数，保证每次生成结果一致
let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

/** 叠加高斯噪点，模拟绘画纹理（噪点越多，调色板量化越难） */
async function grain(img: Buffer, sigma: number): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(img).metadata()
  // 三个均匀分布相加近似高斯分布（libvips 的噪点没有种子，每次都不同）
  const data = Buffer.alloc(width * height * 3)
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, 128 + (rand() + rand() + rand() - 1.5) * 2 * sigma))
  const noise = await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer()
  return sharp(img).composite([{ input: noise, blend: 'soft-light' }]).png().toBuffer()
}

// 1. 大尺寸渐变背景（无透明）：平滑渐变 + 柔光圆斑
const blobs = Array.from({ length: 14 }, () => {
  const [x, y, r] = [rand() * 750, rand() * 1334, 60 + rand() * 180]
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${200 + rand() * 60},80%,${60 + rand() * 25}%)" opacity="${0.25 + rand() * 0.35}" filter="url(#b)"/>`
}).join('')
await sharp(
  svg(
    750,
    1334,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a6b"/><stop offset="0.55" stop-color="#3f7fd8"/><stop offset="1" stop-color="#9fe3ff"/></linearGradient>
     <filter id="b"><feGaussianBlur stdDeviation="40"/></filter></defs>
     <rect width="750" height="1334" fill="url(#g)"/>${blobs}`,
  ),
)
  .png()
  .toFile(`${out}/bg.png`)

// 2. 手绘质感插画（透明底）：模糊色块 + 纹理噪点 + 柔和边缘
const strokes = Array.from({ length: 40 }, () => {
  const [x, y] = [100 + rand() * 400, 100 + rand() * 400]
  return `<ellipse cx="${x}" cy="${y}" rx="${30 + rand() * 90}" ry="${20 + rand() * 60}" transform="rotate(${rand() * 180} ${x} ${y})" fill="hsl(${rand() * 360},70%,55%)" opacity="0.6" filter="url(#s)"/>`
}).join('')
const painted = await grain(
  await sharp(
    svg(600, 600, `<defs><filter id="s"><feGaussianBlur stdDeviation="12"/></filter></defs><rect width="600" height="600" fill="#f4e3c1"/>${strokes}`),
  )
    .png()
    .toBuffer(),
  40,
)
const fade = svg(
  600,
  600,
  `<defs><radialGradient id="m"><stop offset="0.6" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="300" cy="300" r="300" fill="url(#m)"/>`,
)
await sharp(painted).ensureAlpha().composite([{ input: fade, blend: 'dest-in' }]).png().toFile(`${out}/illustration.png`)

// 3. 半透明面板（透明底）：投影 + 渐变描边 + 文字
await sharp(
  svg(
    640,
    420,
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7e0"/><stop offset="1" stop-color="#ffd58a"/></linearGradient>
     <linearGradient id="e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#c2410c"/></linearGradient>
     <filter id="d"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.35"/></filter></defs>
     <rect x="20" y="20" width="600" height="380" rx="36" fill="url(#p)" stroke="url(#e)" stroke-width="8" filter="url(#d)"/>
     <rect x="60" y="120" width="520" height="200" rx="20" fill="#000" opacity="0.08"/>
     <text x="320" y="88" font-family="Helvetica, Arial" font-size="40" font-weight="bold" fill="#7c2d12" text-anchor="middle">每日任务</text>
     <text x="320" y="230" font-family="Helvetica, Arial" font-size="28" fill="#9a3412" text-anchor="middle">完成 3 次挑战，领取奖励</text>`,
  ),
)
  .png()
  .toFile(`${out}/panel.png`)

// 4. 横幅（无透明）：渐变 + 噪点 + 大字
await sharp(
  await grain(
    await sharp(
      svg(
        1000,
        400,
        `<defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7e22ce"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
         <rect width="1000" height="400" fill="url(#h)"/>
         <text x="500" y="230" font-family="Helvetica, Arial" font-size="96" font-weight="bold" fill="#fff" text-anchor="middle">SUMMER PK</text>`,
      ),
    )
      .png()
      .toBuffer(),
    12,
  ),
)
  .toFile(`${out}/banner.png`)

// 5. 按钮（透明底）
await sharp(
  svg(
    320,
    120,
    `<defs><linearGradient id="k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4ade80"/><stop offset="1" stop-color="#15803d"/></linearGradient></defs>
     <rect x="6" y="6" width="308" height="108" rx="54" fill="url(#k)" stroke="#14532d" stroke-width="4"/>
     <rect x="30" y="16" width="260" height="36" rx="18" fill="#fff" opacity="0.3"/>
     <text x="160" y="76" font-family="Helvetica, Arial" font-size="40" font-weight="bold" fill="#fff" text-anchor="middle">领取</text>`,
  ),
)
  .png()
  .toFile(`${out}/button.png`)

// 6. 小图标（< 10KB，应被跳过）
for (const [i, color] of ['#f59e0b', '#3b82f6', '#ef4444'].entries()) {
  await sharp(
    svg(64, 64, `<circle cx="32" cy="32" r="28" fill="${color}"/><path d="M20 33 l8 8 l16 -18" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round"/>`),
  )
    .png()
    .toFile(`${out}/icons/icon-${i + 1}.png`)
}
