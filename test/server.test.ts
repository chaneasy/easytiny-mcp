import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

let dir: string
let client: Client

const call = async (name: string, args: Record<string, unknown>) => {
  const res = await client.callTool({ name, arguments: args })
  return (res.content as { text: string }[])[0].text
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'easytiny-test-'))
  for (const f of ['bg.png', 'panel.png', 'icons/icon-1.png']) await cp(join('img', f), join(dir, f.replace('icons/', '')))
  client = new Client({ name: 'test', version: '0' })
  // 隔离已压缩记录，避免影响本机缓存
  const env = { ...process.env, HOME: dir } as Record<string, string>
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/index.ts'], env }))
}, 60_000)

afterAll(async () => {
  await client?.close()
  await rm(dir, { recursive: true, force: true })
})

test('预览不改动原图，确认后替换', async () => {
  const before = await readFile(join(dir, 'bg.png'))
  const preview = await call('prepare_compression', { paths: [dir] })
  const planId = preview.match(/plan_id: (\w+)/)![1]
  expect(preview).toContain('icon-1.png')
  expect(preview).toMatch(/小于 10KB/)
  expect(await readFile(join(dir, 'bg.png'))).toEqual(before)

  const applied = await call('apply_compression', { plan_id: planId })
  expect(applied).toMatch(/已替换 [1-9]/)
  expect((await stat(join(dir, 'bg.png'))).size).toBeLessThan(before.length)

  expect(await call('apply_compression', { plan_id: planId })).toMatch(/不存在或已过期/)
  // 重复运行时，已压缩过的文件直接跳过
  expect(await call('prepare_compression', { paths: [join(dir, 'bg.png')] })).toContain('已压缩过')
}, 120_000)

test('原图在预览后被改动则不替换', async () => {
  await cp(join('img', 'illustration.png'), join(dir, 'illustration.png'))
  const planId = (await call('prepare_compression', { paths: [join(dir, 'illustration.png')] })).match(/plan_id: (\w+)/)![1]
  await cp(join('img', 'bg.png'), join(dir, 'illustration.png'))
  expect(await call('apply_compression', { plan_id: planId })).toContain('原图在预览后已变更')
}, 120_000)
