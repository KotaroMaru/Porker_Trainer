import type { FlopDef } from '../types'
import flopsJson from './flops.json'

export const FLOPS: FlopDef[] = flopsJson as FlopDef[]

/**
 * weightは全22,100通りに対する真の出現確率で、部分集合の合計は1にならない。
 * 抽選時に渡されたプールの合計で再正規化し、クラス間の正しい相対比を保つ。
 */
export function pickWeightedFlop(pool: FlopDef[] = FLOPS, rng: () => number = Math.random): FlopDef {
  const total = pool.reduce((s, f) => s + f.weight, 0)
  let r = rng() * total
  for (const f of pool) {
    r -= f.weight
    if (r <= 0) return f
  }
  return pool[pool.length - 1]
}
