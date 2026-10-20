# easytiny-mcp

视觉无损的图片批量压缩 MCP 服务。压缩结果先放在临时目录预览，用户确认后才原地替换原图。

## 工具

| 工具 | 作用 |
|---|---|
| `prepare_compression` | 压缩到临时目录，返回 `plan_id` 和预览表（原大小、新大小、编码器、SSIMULACRA2 分数、跳过原因） |
| `apply_compression` | 用户确认后原子替换原图；客户端支持 elicitation 时由服务端直接向用户确认，可选 `backup` |
| `cancel_compression` | 丢弃预览结果 |

## 压缩策略

每种格式一个主力编码器，按固定顺序尝试，采用第一个「节省 ≥3% 且 SSIMULACRA2 ≥85」的结果，最后以无损优化兜底。小于 10KB 或已压缩过的文件直接跳过。

| 格式 | balanced 尝试顺序 |
|---|---|
| JPEG | `cjpegli -d 1.0` → `-d 0.7` → `jpegtran` 无损；原图质量 ≤75 只做无损 |
| PNG | `pngquant 80-98` → 截低位 4 → 截低位 2 → `oxipng` 无损（有损结果都会再过 `oxipng`） |
| WebP | 有损源 `cwebp -q 90` → `-q 93`；无损源 `near_lossless 60` → 无损 |
| AVIF | `avifenc -q 74 -s 6 tune=iq` |
| GIF | `gifsicle -O3 --lossy=40` → `-O3` 无损 |
| SVG | SVGO（保守配置）+ 渲染比对 |

`effort`：`fast` 跳过 SSIMULACRA2 判定、参数更保守；`max` 从更激进的参数逐级放宽，更慢、压缩率更高。

## 开发

```bash
pnpm install
scripts/build-bins.sh         # 编译编码器到 vendor/bin（也可用 EASYTINY_BIN_DIR 指定目录）
pnpm tsx scripts/gen-img.ts   # 重新生成 img/ 下的测试图片（已提交，一般无需运行）
pnpm fixtures                 # 从 img/ 生成其他格式的测试样例
pnpm bench img bench/fixtures [--effort fast|balanced|max] [-v]   # 只输出统计，不改动原图
pnpm test
```

## 接入

支持 macOS（Apple Silicon / Intel）与 Windows x64，需要 Node.js ≥ 20。编码器随平台包自动安装，无需额外依赖。

```bash
# Claude Code：所有项目可用；只想在当前项目用就去掉 --scope user
claude mcp add --scope user easytiny -- npx -y easytiny-mcp
```

其他客户端（Cursor 等）的 JSON 配置：

```json
{ "mcpServers": { "easytiny": { "command": "npx", "args": ["-y", "easytiny-mcp"] } } }
```

本地开发版：先 `pnpm build`，再把命令换成 `node /path/to/easytiny-mcp/dist/index.js`。

## 发布

推送 `v*` tag 后，GitHub Actions 会在各平台编译编码器、跑测试，并发布主包 `easytiny-mcp` 与平台包 `easytiny-mcp-<平台>`：

```bash
git tag v0.1.0 && git push origin v0.1.0
```

npm 认证使用 Trusted Publishing（OIDC），无需长期 token：

1. 首次发布前包还不存在，需要在 npm 生成一个可发布的 Granular Access Token，填入仓库 Secrets 的 `NPM_TOKEN`。
2. 首次发布成功后，在 npmjs.com 上为 4 个包分别添加 Trusted Publisher（仓库 `chaneasy/easytiny-mcp`，工作流 `release.yml`，环境 `npm`），然后删除 `NPM_TOKEN`。
