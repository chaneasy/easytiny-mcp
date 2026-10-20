// 发布前同步版本号：pnpm tsx scripts/release.ts 0.1.0
// 主包写入各平台包的 optionalDependencies（开发时不写，避免 pnpm install 去拉取未发布的包）
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises'

const version = process.argv[2]?.replace(/^v/, '')
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) throw new Error('用法：release.ts <版本号>')

const edit = async (file: string, fn: (pkg: Record<string, any>) => void) => {
  const pkg = JSON.parse(await readFile(file, 'utf8'))
  fn(pkg)
  await writeFile(file, JSON.stringify(pkg, null, 2) + '\n')
  return pkg.name as string
}

const names: string[] = []
for (const dir of await readdir('npm', { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  await copyFile('npm/THIRD_PARTY_NOTICES.md', `npm/${dir.name}/THIRD_PARTY_NOTICES.md`)
  names.push(await edit(`npm/${dir.name}/package.json`, (p) => void (p.version = version)))
}
await edit('package.json', (p) => {
  p.version = version
  p.optionalDependencies = Object.fromEntries(names.map((n) => [n, version]))
})
console.log(`版本 ${version}：${names.join(', ')}`)
