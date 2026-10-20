// 用法：pnpm bench <目录或文件...> [--effort fast|balanced|max] [--min-score 85] [-v]
// 只在临时目录产出结果，不会改动原图
import { mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { collect, compressFile, defaults, pool, type FileResult } from '../src/compress.js'
import type { Effort } from '../src/types.js'

sharp.concurrency(1)

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    effort: { type: 'string', default: defaults.effort },
    'min-score': { type: 'string', default: String(defaults.minScore) },
    v: { type: 'boolean', default: false },
  },
})
const opts = { ...defaults, effort: values.effort as Effort, minScore: Number(values['min-score']) }
const dir = await mkdtemp(join(tmpdir(), 'easytiny-bench-'))
const files = await collect(positionals.length ? positionals : ['img'], true)

const t0 = performance.now()
const results = await pool(files, availableParallelism(), (p) => compressFile(p, dir, opts))
const wall = performance.now() - t0
await rm(dir, { recursive: true, force: true })

const kb = (n: number) => (n / 1024).toFixed(1)
if (values.v) {
  for (const r of results) {
    const name = relative(process.cwd(), r.path)
    console.log(
      r.status === 'ok'
        ? `✓ ${name}  ${kb(r.size)}→${kb(r.newSize!)}KB  ${r.encoder}#${r.attempt}  score=${r.score?.toFixed(1) ?? '-'}  ${r.ms.toFixed(0)}ms`
        : `- ${name}  ${r.reason}  ${r.ms.toFixed(0)}ms`,
    )
  }
  console.log()
}

const groups = Map.groupBy(results, (r: FileResult) => extname(r.path).toLowerCase().replace('.jpeg', '.jpg'))
console.table(
  [...groups].map(([ext, rs]) => {
    const ok = rs.filter((r) => r.status === 'ok')
    const before = ok.reduce((s, r) => s + r.size, 0)
    const after = ok.reduce((s, r) => s + r.newSize!, 0)
    return {
      格式: ext,
      文件数: rs.length,
      已压缩: ok.length,
      首次通过: ok.filter((r) => r.attempt === 0).length,
      '节省(已压缩部分)': before ? `${((1 - after / before) * 100).toFixed(1)}%` : '-',
      平均耗时ms: Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length),
    }
  }),
)
console.log(`effort=${opts.effort} minScore=${opts.minScore} 总耗时 ${(wall / 1000).toFixed(1)}s`)
