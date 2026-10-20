import { randomUUID } from 'node:crypto'
import { availableParallelism, tmpdir } from 'node:os'
import { chmod, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import { collect, compressFile, hashFile, markDone, pool, type FileResult, type Options } from './compress.js'

// 文件级并发已占满 CPU，libvips 内部不再开多线程
sharp.concurrency(1)

const TTL = 30 * 60 * 1000

export interface Plan {
  id: string
  dir: string
  files: FileResult[]
}

const plans = new Map<string, Plan>()

export async function createPlan(
  paths: string[],
  opts: Options,
  onProgress?: (done: number, total: number) => void,
): Promise<Plan> {
  const id = randomUUID().slice(0, 8)
  const dir = join(tmpdir(), 'easytiny', id)
  await mkdir(dir, { recursive: true })
  const list = await collect(paths, opts.recursive)
  let n = 0
  const files = await pool(list, availableParallelism(), async (p) => {
    const r = await compressFile(p, dir, opts).catch(
      (e): FileResult => ({ path: p, size: 0, mtimeMs: 0, status: 'skip', reason: (e as Error).message, ms: 0 }),
    )
    onProgress?.(++n, list.length)
    return r
  })
  const plan = { id, dir, files }
  plans.set(id, plan)
  setTimeout(() => void cancelPlan(id), TTL).unref()
  return plan
}

export const getPlan = (id: string) => plans.get(id)

export async function cancelPlan(id: string): Promise<boolean> {
  const plan = plans.get(id)
  if (!plan) return false
  plans.delete(id)
  await rm(plan.dir, { recursive: true, force: true })
  return true
}

export interface ApplyResult {
  replaced: FileResult[]
  failed: { path: string; reason: string }[]
}

/** 原子替换：先写同目录临时文件再 rename；原图在预览后被改动则跳过 */
export async function applyPlan(id: string, backup: boolean): Promise<ApplyResult> {
  const plan = plans.get(id)
  if (!plan) throw new Error(`计划 ${id} 不存在或已过期`)
  const result: ApplyResult = { replaced: [], failed: [] }
  for (const f of plan.files) {
    if (f.status !== 'ok' || !f.out) continue
    try {
      const s = await stat(f.path)
      if (s.size !== f.size || s.mtimeMs !== f.mtimeMs) throw new Error('原图在预览后已变更')
      if (backup) {
        const bakDir = join(dirname(f.path), '.image-backup')
        await mkdir(bakDir, { recursive: true })
        await copyFile(f.path, join(bakDir, basename(f.path)))
      }
      const tmp = `${f.path}.easytiny-tmp`
      await copyFile(f.out, tmp)
      await chmod(tmp, s.mode)
      await rename(tmp, f.path)
      await markDone(await hashFile(f.path))
      result.replaced.push(f)
    } catch (e) {
      result.failed.push({ path: f.path, reason: (e as Error).message })
    }
  }
  await cancelPlan(id)
  return result
}
