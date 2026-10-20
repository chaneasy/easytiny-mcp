import { readFile, writeFile } from 'node:fs/promises'
import { optimize, type Config } from 'svgo'
import type { Compressor } from '../types.js'

// svgo v4 的 preset-default 已不再移除 viewBox 与 <title>
const config: Config = {
  multipass: true,
  floatPrecision: 3,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // id 可能被页面 CSS/JS 或外部 <use href="x.svg#id"> 引用（如雪碧图 <symbol>），判定无法发现
          cleanupIds: false,
          // 根节点 display:none 的雪碧图会被整体删空；隐藏元素也可能由 CSS/JS 切换显示
          removeHiddenElems: false,
          removeUnknownsAndDefaults: { keepRoleAttr: true },
        },
      },
    },
  ],
}

export const svg: Compressor = async (src) => [
  {
    encoder: 'svgo',
    async run(out) {
      const text = await readFile(src, 'utf8')
      if (/<script[\s>/]/i.test(text)) throw new Error('含 <script>，跳过')
      const { data } = optimize(text, { path: src, ...config })
      if (!data.includes('<svg')) throw new Error('svgo 输出为空')
      await writeFile(out, data)
    },
  },
]
