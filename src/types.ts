export type Effort = 'fast' | 'balanced' | 'max'

/** 一次压缩尝试：把 src 编码写入 out，抛错视为本次尝试失败 */
export interface Attempt {
  encoder: string
  /** 无损尝试不做质量判定 */
  lossless?: boolean
  run(out: string): Promise<void>
}

/**
 * 按优先级返回尝试列表，调度器依次执行，采用第一个「节省足够且通过判定」的结果。
 * 返回空数组表示跳过该文件。
 */
export type Compressor = (src: string, effort: Effort) => Promise<Attempt[]>
