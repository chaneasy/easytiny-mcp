# easytiny-mcp

视觉无损的图片批量压缩 MCP 服务。压缩结果先放在临时目录预览，用户确认后才原地替换原图。

## 工具

| 工具 | 作用 |
|---|---|
| `prepare_compression` | 压缩到临时目录，返回 `plan_id` 和预览表（原大小、新大小、编码器、SSIMULACRA2 分数、跳过原因） |
| `apply_compression` | 用户在聊天中确认后，传入 `plan_id` 和必填的 `confirmed: true` 原子替换原图，不再发起额外确认表单，可选 `backup` |
| `cancel_compression` | 丢弃预览结果 |

## 确认与替换流程

1. 调用 `prepare_compression`，将返回的预览表完整展示给用户，原图保持不变。
2. 用户在聊天中明确同意替换该计划后，调用 `apply_compression({ plan_id, confirmed: true })`；需要备份时额外传入 `backup: true`。
3. 服务端校验确认参数和计划，再检查原图是否发生变化并执行替换。无论客户端是否支持 elicitation，都不会再次请求确认表单。

`confirmed` 无默认值：省略、传 `false` 或传字符串 `"true"` 都不会替换文件，计划仍可在有效期内重新提交。计划有效期为 30 分钟，失效或服务重启后需要重新生成预览并获得确认。

此参数是调用方对已有用户授权的明确声明；服务端能校验参数，不能直接读取或验证聊天内容。调用方必须确认授权对应当前 `plan_id`，不得自行填 `true`。客户端自身的工具审批策略仍然生效。

升级时，原先只传 `{ plan_id }` 的调用及工作流说明需同步增加 `confirmed: true`（仅在用户已同意后）。已运行的 MCP 服务需重启或重新连接以加载新的工具定义；固定使用 npm 旧版本的配置不会自动使用本地修改。

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

推送 `v*` tag 后，GitHub Actions 会在各平台编译编码器、跑测试，并发布主包 `easytiny-mcp` 与平台包 `easytiny-mcp-darwin-arm64`、`easytiny-mcp-darwin-x64`、`@easychan/easytiny-mcp-win32-x64`：

```bash
git tag v0.2.0 && git push origin v0.2.0
```

npm 认证使用 Trusted Publishing（OIDC），无需长期 token：

1. 首次发布前包还不存在，需要在 npm 生成一个可发布的 Granular Access Token，填入仓库 Secrets 的 `NPM_TOKEN`。
2. 首次发布成功后，在 npmjs.com 上为 4 个包分别添加 Trusted Publisher（仓库 `chaneasy/easytiny-mcp`，工作流 `release.yml`，环境 `npm`），然后删除 `NPM_TOKEN`。
