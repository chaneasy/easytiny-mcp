import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { avif } from './compressors/avif.js'
import { gif } from './compressors/gif.js'
import { jpeg } from './compressors/jpeg.js'
import { png } from './compressors/png.js'
import { svg } from './compressors/svg.js'
import { webp } from './compressors/webp.js'
import { score } from './metric.js'
import type { Compressor, Effort } from './types.js'

const compressors: Record<string, Compressor> = {
  '.jpg': jpeg,
  '.jpeg': jpeg,
  '.png': png,
  '.webp': webp,
  '.avif': avif,
  '.gif': gif,
  '.svg': svg,
}

export interface Options {
  effort: Effort
  /** SSIMULACRA2 及格线 */
  minScore: number
  /** 最低节省比例，低于此值不替换 */
  minSaving: number
  /** 小于此字节数的文件直接跳过 */
  minSize: number
  recursive: boolean
}

export const defaults: Options = { effort: 'balanced', minScore: 85, minSaving: 0.03, minSize: 10 * 1024, recursive: true }

export interface FileResult {
  path: string
  size: number
  mtimeMs: number
  status: 'ok' | 'skip'
  reason?: string
  /** 压缩结果的临时路径 */
  out?: string
  newSize?: number
  encoder?: string
  score?: number
  /** 采用的是第几次尝试（0 为首次即通过） */
  attempt?: number
  ms: number
}

// 已压缩文件的内容哈希，重复运行时直接跳过
const doneFile = join(homedir(), '.cache', 'easytiny', 'done.txt')
let done: Set<string> | undefined

export const hashFile = async (p: string) => createHash('sha1').update(await readFile(p)).digest('hex')

async function doneSet(): Promise<Set<string>> {
  done ??= new Set((await readFile(doneFile, 'utf8').catch(() => '')).split('\n').filter(Boolean))
  return done
}

export async function markDone(hash: string): Promise<void> {
  ;(await doneSet()).add(hash)
  await mkdir(dirname(doneFile), { recursive: true })
  await appendFile(doneFile, hash + '\n')
}

/** 展开目录，跳过隐藏目录与 node_modules */
export async function collect(paths: string[], recursive: boolean): Promise<string[]> {
  const files: string[] = []
  const walk = async (p: string, top: boolean): Promise<void> => {
    const s = await stat(p)
    if (s.isFile()) {
      if (compressors[extname(p).toLowerCase()]) files.push(p)
    } else if (s.isDirectory() && (top || recursive)) {
      for (const e of await readdir(p, { withFileTypes: true })) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        if (e.isFile() || e.isDirectory()) await walk(join(p, e.name), false)
      }
    }
  }
  for (const p of paths) await walk(resolve(p), true)
  return [...new Set(files)]
}

export async function compressFile(path: string, workDir: string, opts: Options): Promise<FileResult> {
  const t0 = performance.now()
  const { size, mtimeMs } = await stat(path)
  const base = { path, size, mtimeMs }
  const skip = (reason: string): FileResult => ({ ...base, status: 'skip', reason, ms: performance.now() - t0 })

  if (size < opts.minSize) return skip(`小于 ${opts.minSize >> 10}KB`)
  if ((await doneSet()).has(await hashFile(path))) return skip('已压缩过')

  let attempts
  try {
    attempts = await compressors[extname(path).toLowerCase()](path, opts.effort)
  } catch (e) {
    return skip(`无法读取: ${(e as Error).message.split('\n')[0]}`)
  }
  const id = createHash('sha1').update(path).digest('hex').slice(0, 8)
  let reason = '节省不足或未通过视觉无损判定'
  const firstLine = (e: unknown) => (e as Error).message.split('\n')[0]
  for (const [i, a] of attempts.entries()) {
    const out = join(workDir, `${id}-${i}-${basename(path)}`)
    try {
      await a.run(out)
    } catch (e) {
      reason = `${a.encoder}: ${firstLine(e)}`
      continue
    }
    const newSize = (await stat(out)).size
    if (newSize > size * (1 - opts.minSaving)) continue
    let s: number | undefined
    if (!a.lossless && opts.effort !== 'fast') {
      try {
        s = await score(path, out, join(workDir, id))
      } catch (e) {
        reason = `判定失败: ${firstLine(e)}`
        continue
      }
      if (s < opts.minScore) continue
    }
    return { ...base, status: 'ok', out, newSize, encoder: a.encoder, score: s, attempt: i, ms: performance.now() - t0 }
  }
  return skip(attempts.length ? reason : '无适用方案')
}

/** 按 CPU 核数并发处理 */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const k = next++
      out[k] = await fn(items[k])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}
