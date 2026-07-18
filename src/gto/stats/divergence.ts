// P11 Phase D-1/D-2: NF5「GTOズレ測定」の集計ロジック。
// grading.tsのgradeDecisionが返すactionBreakdownは、そのヒーローコンボにおける
// GTO混合戦略頻度分布そのもの(実際に配られたコンボではfreq合計が1に正規化されている。
// grading.test.ts「異常EV防御」参照・gameFlow.tsのapplyUserActionは常に実際に
// 配られたユーザーコンボのcomboIdxを渡すため、この前提はアプリの実利用経路で成立する)。
// 新たなエクイティ/頻度計算は行わず、既存のactionBreakdownとchosenLabelを読むだけの
// 純粋な集計関数群。UI・store配線は別タスク(Phase D-3/D-4)で扱う。

import type { ActionBreakdownEntry } from '../trainer/grading'
import { bucketOf, type ActionBucket } from './actionBucket'

const BUCKETS: readonly ActionBucket[] = ['fold', 'passive', 'aggressive']

export interface DivergenceTally {
  decisionCount: number
  userCount: Record<ActionBucket, number>
  gtoFreqSum: Record<ActionBucket, number>
}

export function initialDivergenceTally(): DivergenceTally {
  return {
    decisionCount: 0,
    userCount: { fold: 0, passive: 0, aggressive: 0 },
    gtoFreqSum: { fold: 0, passive: 0, aggressive: 0 },
  }
}

/** 1決断を取り込む純関数(破壊的変更をせず新しいtallyを返す)。 */
export function accumulateDivergence(
  tally: DivergenceTally,
  breakdown: readonly ActionBreakdownEntry[],
  chosenLabel: string,
): DivergenceTally {
  const userCount = { ...tally.userCount }
  const gtoFreqSum = { ...tally.gtoFreqSum }

  userCount[bucketOf(chosenLabel)] += 1
  for (const entry of breakdown) {
    gtoFreqSum[bucketOf(entry.label)] += entry.freq
  }

  return {
    decisionCount: tally.decisionCount + 1,
    userCount,
    gtoFreqSum,
  }
}

export interface DivergenceBucketSummary {
  bucket: ActionBucket
  userRate: number
  gtoRate: number
  diff: number
}

export interface DivergenceSummary {
  count: number
  buckets: DivergenceBucketSummary[]
}

export function summarizeDivergence(tally: DivergenceTally): DivergenceSummary {
  const count = tally.decisionCount
  if (count === 0) {
    return {
      count: 0,
      buckets: BUCKETS.map((bucket) => ({ bucket, userRate: 0, gtoRate: 0, diff: 0 })),
    }
  }

  return {
    count,
    buckets: BUCKETS.map((bucket) => {
      const userRate = tally.userCount[bucket] / count
      const gtoRate = tally.gtoFreqSum[bucket] / count
      return { bucket, userRate, gtoRate, diff: userRate - gtoRate }
    }),
  }
}
