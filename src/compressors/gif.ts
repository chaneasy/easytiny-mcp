import { run } from '../exec.js'
import type { Attempt, Compressor, Effort } from '../types.js'

// --lossy 档位：balanced 由判定兜底可略激进；fast 不做判定，保守取 20；max 由高到低搜索
const ladders: Record<Effort, number[]> = {
  fast: [20],
  balanced: [40],
  max: [120, 80, 40, 20],
}

const gifsicle = (src: string, extra: string[]): Attempt['run'] => async (out) => {
  await run('gifsicle', ['-O3', '--no-comments', '--no-extensions', ...extra, src, '-o', out])
}

export const gif: Compressor = async (src, effort) => [
  ...ladders[effort].map((n) => ({ encoder: `gifsicle-lossy${n}`, run: gifsicle(src, [`--lossy=${n}`]) })),
  { encoder: 'gifsicle', lossless: true, run: gifsicle(src, []) },
]
