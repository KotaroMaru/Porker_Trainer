import type { FlopDef } from '../types'
import flopsJson from './flops.json'

export const FLOPS: FlopDef[] = flopsJson as FlopDef[]

/** 重み付きランダム抽選で代表フロップ1つを選ぶ。 */
export function pickWeightedFlop(pool: FlopDef[] = FLOPS, rng: () => number = Math.random): FlopDef {
  const total = pool.reduce((s, f) => s + f.weight, 0)
  let r = rng() * total
  for (const f of pool) {
    r -= f.weight
    if (r <= 0) return f
  }
  return pool[pool.length - 1]
}
