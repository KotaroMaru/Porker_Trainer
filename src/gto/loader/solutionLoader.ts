// P3 Step 4: 事前計算済みフロップ解の遅延ロード+メモリLRUキャッシュ。
// ファイルは public/gto/solutions/{scenarioId}/{flop}.bin (FORMAT.md準拠)。

import { decodeSolutionFile, type DecodedSolution } from './binaryFormat'

const LRU_CAPACITY = 4

class SolutionLru {
  private map = new Map<string, DecodedSolution>()
  get(key: string): DecodedSolution | undefined {
    const v = this.map.get(key)
    if (v) {
      // LRU: アクセスしたエントリを最新として末尾に移動
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }
  set(key: string, value: DecodedSolution): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > LRU_CAPACITY) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }
  clear(): void {
    this.map.clear()
  }
}

const cache = new SolutionLru()
const inflight = new Map<string, Promise<DecodedSolution>>()

/**
 * テスト専用: モジュールレベルのLRUキャッシュをクリアする。cacheはテストファイルの
 * 生存期間中ずっと共有されるため、「fetch失敗時のエラーハンドリング」のように
 * 必ずfetchを実際に呼ばせたいテストでは、直前に呼んでキャッシュヒットによる
 * すり抜け(ランダムに選ばれたフロップが直近のテストで偶然キャッシュ済みだった
 * 場合に発生する)を防ぐ。
 */
export function __resetSolutionCacheForTests(): void {
  cache.clear()
  inflight.clear()
}

function solutionKey(scenarioId: string, flopId: string): string {
  return `${scenarioId}/${flopId}`
}

/**
 * 事前計算済みフロップ解を読み込む。メモリLRU(直近4件)でキャッシュし、
 * 同一キーへの同時リクエストはfetchを1回に重複排除する。
 * flopIdはFORMAT.md準拠のrust形式カード文字列(例: "QhTd8c")。
 */
export async function loadFlopSolution(scenarioId: string, flopId: string): Promise<DecodedSolution> {
  const key = solutionKey(scenarioId, flopId)
  const cached = cache.get(key)
  if (cached) return cached

  const existing = inflight.get(key)
  if (existing) return existing

  const promise = (async () => {
    const url = `/gto/solutions/${scenarioId}/${flopId}.bin`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch GTO solution ${url}: ${res.status}`)
    const buf = await res.arrayBuffer()
    const decoded = decodeSolutionFile(buf)
    cache.set(key, decoded)
    return decoded
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

/** ノードIDから戦略/EVを引く。見つからない場合はundefined(未到達ノード等)。 */
export function getStrategy(
  solution: DecodedSolution,
  nodeId: string,
): { player: 0 | 1; actionLabels: string[]; freqs: Float32Array; evsBb: Float32Array } | undefined {
  return solution.nodes.get(nodeId)
}
