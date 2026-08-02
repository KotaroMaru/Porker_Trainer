import type { FlopDef } from '../types'

export type FlopTextureStratum =
  | 'monotone-unpaired'
  | 'monotone-paired'
  | 'twoTone-unpaired'
  | 'twoTone-paired'
  | 'rainbow-unpaired'
  | 'rainbow-paired'

const STRATA: FlopTextureStratum[] = [
  'monotone-unpaired',
  'monotone-paired',
  'twoTone-unpaired',
  'twoTone-paired',
  'rainbow-unpaired',
  'rainbow-paired',
]

export function flopTextureStratum(flop: FlopDef): FlopTextureStratum {
  const suitTexture = flop.texture.monotone ? 'monotone' : flop.texture.twoTone ? 'twoTone' : 'rainbow'
  return `${suitTexture}-${flop.texture.paired ? 'paired' : 'unpaired'}`
}

/**
 * 各時点の理想累積件数に最も遅れている層を選び、入力順を保ったまま決定的に層化する。
 * その並びを指定件数で切るため、各バッチは全体のテクスチャ構成比に近くなる。
 */
export function createStratifiedFlopBatches(flops: readonly FlopDef[], batchSize: number): FlopDef[][] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('batchSizeは正の整数である必要があります')
  }
  if (flops.length === 0) return []

  const groups = new Map(STRATA.map((stratum) => [stratum, [] as FlopDef[]]))
  for (const flop of flops) groups.get(flopTextureStratum(flop))?.push(flop)

  const used = new Map(STRATA.map((stratum) => [stratum, 0]))
  const stratified: FlopDef[] = []
  while (stratified.length < flops.length) {
    let selected: FlopTextureStratum | undefined
    let largestDeficit = -Infinity

    for (const stratum of STRATA) {
      const group = groups.get(stratum) ?? []
      const usedCount = used.get(stratum) ?? 0
      if (usedCount >= group.length) continue
      const idealCumulative = ((stratified.length + 1) * group.length) / flops.length
      const deficit = idealCumulative - usedCount
      if (deficit > largestDeficit) {
        selected = stratum
        largestDeficit = deficit
      }
    }

    if (selected === undefined) throw new Error('層化中に未配置のフロップを選択できませんでした')
    const selectedIndex = used.get(selected) ?? 0
    stratified.push((groups.get(selected) ?? [])[selectedIndex])
    used.set(selected, selectedIndex + 1)
  }

  const batches: FlopDef[][] = []
  for (let offset = 0; offset < stratified.length; offset += batchSize) {
    batches.push(stratified.slice(offset, offset + batchSize))
  }
  return batches
}
