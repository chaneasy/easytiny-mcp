#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { relative } from 'node:path'
import { z } from 'zod'
import { defaults } from './compress.js'
import { applyPlan, cancelPlan, createPlan, getPlan, type Plan } from './plan.js'

const kb = (n: number) => `${(n / 1024).toFixed(1)}KB`
const rel = (p: string) => relative(process.cwd(), p) || p
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

function report(plan: Plan): string {
  const ok = plan.files.filter((f) => f.status === 'ok')
  const before = ok.reduce((s, f) => s + f.size, 0)
  const after = ok.reduce((s, f) => s + f.newSize!, 0)
  const rows = plan.files.map((f) =>
    f.status === 'ok'
      ? `| ${rel(f.path)} | ${kb(f.size)} | ${kb(f.newSize!)} | -${((1 - f.newSize! / f.size) * 100).toFixed(1)}% | ${f.encoder} | ${f.score?.toFixed(1) ?? '-'} |`
      : `| ${rel(f.path)} | ${kb(f.size)} | - | 跳过 | ${f.reason} | - |`,
  )
  return [
    `plan_id: ${plan.id}`,
    `可压缩 ${ok.length}/${plan.files.length} 个文件，${kb(before)} → ${kb(after)}（节省 ${kb(before - after)}）`,
    '',
    '| 文件 | 原大小 | 新大小 | 节省 | 编码器 / 跳过原因 | SSIMULACRA2 |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

const server = new McpServer({ name: 'easytiny-mcp', version: '0.2.0' })

server.registerTool(
  'prepare_compression',
  {
    title: '预览图片压缩',
    description:
      '视觉无损压缩图片（JPEG/PNG/WebP/AVIF/GIF/SVG），结果存放在临时目录，不修改原图。' +
      '返回 plan_id 和预览表。必须把预览表完整展示给用户，并在用户明确同意替换该计划后，才能调用 apply_compression 并传入 confirmed: true。',
    inputSchema: {
      paths: z.array(z.string()).min(1).describe('图片文件或目录路径，建议使用绝对路径'),
      recursive: z.boolean().default(defaults.recursive).describe('是否递归子目录'),
      effort: z
        .enum(['fast', 'balanced', 'max'])
        .default(defaults.effort)
        .describe('fast：跳过质量判定；balanced：默认；max：更高压缩率、更慢'),
      min_score: z.number().min(50).max(100).default(defaults.minScore).describe('SSIMULACRA2 及格线，85 为视觉无损'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ paths, recursive, effort, min_score }, extra) => {
    const token = extra._meta?.progressToken
    const plan = await createPlan(paths, { ...defaults, recursive, effort, minScore: min_score }, (done, total) => {
      if (token !== undefined)
        void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: token, progress: done, total } })
    })
    return text(report(plan))
  },
)

server.registerTool(
  'apply_compression',
  {
    title: '替换原图',
    description:
      '用 prepare_compression 的结果替换原图。只能在用户看过该 plan_id 的预览表并在聊天中明确同意替换后调用，' +
      '将已有授权通过 confirmed: true 传入；不得自行推断授权。服务端校验确认参数，不再发起额外确认表单。',
    inputSchema: {
      plan_id: z.string().describe('prepare_compression 返回的 plan_id'),
      confirmed: z.boolean().describe('必填。仅在用户已看过该计划的预览表并明确同意替换后传 true；未获授权不得传 true'),
      backup: z.boolean().default(false).describe('替换前把原图备份到同目录的 .image-backup/'),
    },
    annotations: { destructiveHint: true },
  },
  async ({ plan_id, confirmed, backup }) => {
    if (confirmed !== true)
      return { ...text('未收到该计划的明确替换授权，原图未改动。请先展示预览并获得用户同意，再传入 confirmed: true。'), isError: true }
    const plan = getPlan(plan_id)
    if (!plan) return { ...text(`计划 ${plan_id} 不存在或已过期，请重新调用 prepare_compression`), isError: true }
    const { replaced, failed } = await applyPlan(plan_id, backup)
    const saved = replaced.reduce((s, f) => s + f.size - f.newSize!, 0)
    return text(
      [
        `已替换 ${replaced.length} 个文件，共节省 ${kb(saved)}`,
        ...failed.map((f) => `- 未替换 ${rel(f.path)}：${f.reason}`),
      ].join('\n'),
    )
  },
)

server.registerTool(
  'cancel_compression',
  {
    title: '取消压缩计划',
    description: '丢弃 prepare_compression 的结果并清理临时文件，原图不受影响。',
    inputSchema: { plan_id: z.string() },
  },
  async ({ plan_id }) => text((await cancelPlan(plan_id)) ? '已取消' : `计划 ${plan_id} 不存在或已过期`),
)

await server.connect(new StdioServerTransport())
