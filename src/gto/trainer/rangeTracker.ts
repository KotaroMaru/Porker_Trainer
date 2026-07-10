// P4 Step 1(P5/P6基盤): 観測されたアクションから、相手のレンジ重みをベイズ更新する。
// w_i *= max(strategy_i(a), ε) → 正規化(合計1)。ボットはGTOサンプリングなので
// 厳密に整合するが、ユーザーが頻度0の行動を取ってもεフロアでレンジが空にならない。
// P4のUIでは未使用(単発モードは最初の決断のみ)。P5/P6の通しモードで、
// フロップ→ターンへ相手レンジを引き継ぐ際に使う。

export const RANGE_TRACKER_EPSILON = 0.005

/**
 * 観測されたアクションaの頻度(コンボごとのstrategy_i(a))から、レンジ重みを更新する。
 * weights/freqsForActionは同じ長さ・同じコンボ順序であること。戻り値は合計1に正規化済み。
 */
export function updateRangeWeights(weights: number[], freqsForAction: number[]): number[] {
  if (weights.length !== freqsForAction.length) {
    throw new Error('updateRangeWeights: weights and freqsForAction must have the same length')
  }
  const updated = weights.map((w, i) => w * Math.max(freqsForAction[i], RANGE_TRACKER_EPSILON))
  const total = updated.reduce((a, b) => a + b, 0)
  if (total <= 0) throw new Error('updateRangeWeights: all weights became zero (should be impossible with epsilon floor)')
  return updated.map((w) => w / total)
}
