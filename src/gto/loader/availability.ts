// P6 Step B9: 各シナリオの解データ生成状況をmanifest.jsonから自動検出する。
// バッチ生成(tools/solver/precompute)は数週間かけて1シナリオずつ順次実行されるため、
// アプリは「現時点で生成済みのフロップ」だけを出題プールに使う(--resumeで進捗する
// manifest.jsonを都度読み直す。生成中でもMIN_FLOPS_FOR_PLAY以上あれば出題対象に含める)。

/** このフロップ数に達したシナリオから出題対象に含める(確定判断2、2026-07-11)。 */
export const MIN_FLOPS_FOR_PLAY = 20

interface ManifestEntry {
  flop: string
  expl_pot_frac: number
  seconds: number
  bytes: number
}

function isManifestEntry(v: unknown): v is ManifestEntry {
  return typeof v === 'object' && v !== null && typeof (v as { flop?: unknown }).flop === 'string'
}

/**
 * 指定シナリオID群それぞれの manifest.json (`/gto/solutions/{id}/manifest.json`) を取得し、
 * シナリオID→生成済みフロップID配列(FlopDef.cards.join('')形式)のMapを返す。
 * 404・ネットワークエラー・不正なJSON形状のシナリオは結果から除外する(未生成扱い)。
 * Promise.allSettledで並列取得するため、1つの失敗が他のシナリオの取得を妨げない。
 */
export async function detectAvailability(scenarioIds: readonly string[]): Promise<Map<string, string[]>> {
  const results = await Promise.allSettled(
    scenarioIds.map(async (id): Promise<readonly [string, string[]]> => {
      const res = await fetch(`/gto/solutions/${id}/manifest.json`)
      if (!res.ok) throw new Error(`manifest not found for scenario "${id}": ${res.status}`)
      const data: unknown = await res.json()
      if (!Array.isArray(data)) throw new Error(`manifest for scenario "${id}" is not an array`)
      return [id, data.filter(isManifestEntry).map((e) => e.flop)]
    }),
  )

  const map = new Map<string, string[]>()
  for (const r of results) {
    if (r.status === 'fulfilled') map.set(r.value[0], r.value[1])
  }
  return map
}

/** availabilityのうち、MIN_FLOPS_FOR_PLAY以上のフロップが生成済みのシナリオID集合を返す。 */
export function playableScenarioIds(availability: ReadonlyMap<string, string[]>): Set<string> {
  const out = new Set<string>()
  for (const [id, flops] of availability) {
    if (flops.length >= MIN_FLOPS_FOR_PLAY) out.add(id)
  }
  return out
}
