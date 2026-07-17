/** 文字列を32bit値へ安定して畳み込み、日付ベース出題の再現性を担保する。 */
function hashSeed(seed: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return value >>> 0
}

/** 同じ文字列から常に同じ[0, 1)の乱数列を返す、小さな決定的PRNG。 */
export function createSeededRng(seed: string): () => number {
  let state = hashSeed(seed)
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
