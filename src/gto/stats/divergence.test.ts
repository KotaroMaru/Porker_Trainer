// P11 Phase D-2: accumulateDivergence/summarizeDivergenceのテスト。
// AGENTS.mdの★GTOドメイン最重要ルールに従い、頻度の正規化に由来する数値的性質
// (gtoFreqSumの3bucket合計 === decisionCount、userCountの3bucket合計 === decisionCount、
// summarizeDivergenceのuserRate/gtoRate合計≈1・diff合計≈0)を、浮動小数点許容誤差を
// 明示した上で検証する。手作りフィクスチャに加え、実.binフィクスチャ由来の実データでも
// 検証する。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  initialDivergenceTally,
  accumulateDivergence,
  summarizeDivergence,
  type DivergenceTally,
} from './divergence'
import type { ActionBreakdownEntry } from '../trainer/grading'
import { gradeDecision } from '../trainer/grading'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'

/** freq合計が1になる(正規化済みの)手作りbreakdownを作るヘルパー。 */
function breakdown(entries: Record<string, number>): ActionBreakdownEntry[] {
  const sum = Object.values(entries).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1, 9) // フィクスチャ自体の前提を保証する
  return Object.entries(entries).map(([label, freq]) => ({ label, freq, evBb: 0 }))
}

function sumBuckets(record: Record<'fold' | 'passive' | 'aggressive', number>): number {
  return record.fold + record.passive + record.aggressive
}

describe('initialDivergenceTally', () => {
  it('全カウント0で初期化される', () => {
    const tally = initialDivergenceTally()
    expect(tally.decisionCount).toBe(0)
    expect(tally.userCount).toEqual({ fold: 0, passive: 0, aggressive: 0 })
    expect(tally.gtoFreqSum).toEqual({ fold: 0, passive: 0, aggressive: 0 })
  })
})

describe('accumulateDivergence', () => {
  it('破壊的変更をせず新しいtallyを返す(入力を変更しない)', () => {
    const before = initialDivergenceTally()
    const beforeSnapshot: DivergenceTally = JSON.parse(JSON.stringify(before))
    const bd = breakdown({ fold: 0.3, check: 0.5, bet33: 0.2 })
    accumulateDivergence(before, bd, 'check')
    expect(before).toEqual(beforeSnapshot)
  })

  it('chosenLabelのbucketのuserCountを+1する', () => {
    const bd = breakdown({ fold: 0.3, check: 0.5, bet33: 0.2 })
    const t1 = accumulateDivergence(initialDivergenceTally(), bd, 'fold')
    expect(t1.userCount).toEqual({ fold: 1, passive: 0, aggressive: 0 })

    const t2 = accumulateDivergence(initialDivergenceTally(), bd, 'check')
    expect(t2.userCount).toEqual({ fold: 0, passive: 1, aggressive: 0 })

    const t3 = accumulateDivergence(initialDivergenceTally(), bd, 'bet33')
    expect(t3.userCount).toEqual({ fold: 0, passive: 0, aggressive: 1 })
  })

  it('breakdownの各エントリのfreqをbucketOf(entry.label)のgtoFreqSumへ加算する', () => {
    const bd = breakdown({ fold: 0.1, check: 0.2, call: 0.3, bet33: 0.15, raise55: 0.15, allin: 0.1 })
    const t = accumulateDivergence(initialDivergenceTally(), bd, 'fold')
    expect(t.gtoFreqSum.fold).toBeCloseTo(0.1, 9)
    expect(t.gtoFreqSum.passive).toBeCloseTo(0.5, 9) // check+call
    expect(t.gtoFreqSum.aggressive).toBeCloseTo(0.4, 9) // bet33+raise55+allin
  })

  it('decisionCountを+1する', () => {
    const bd = breakdown({ fold: 1 })
    let tally = initialDivergenceTally()
    tally = accumulateDivergence(tally, bd, 'fold')
    expect(tally.decisionCount).toBe(1)
    tally = accumulateDivergence(tally, bd, 'fold')
    expect(tally.decisionCount).toBe(2)
  })

  it('未知ラベルのchosenLabelはbucketOf経由でthrowする', () => {
    const bd = breakdown({ fold: 1 })
    expect(() => accumulateDivergence(initialDivergenceTally(), bd, 'unknown')).toThrow()
  })

  it('breakdownに未知ラベルが含まれる場合もbucketOf経由でthrowする', () => {
    const bd: ActionBreakdownEntry[] = [
      { label: 'fold', freq: 0.5, evBb: 0 },
      { label: 'weird', freq: 0.5, evBb: 0 },
    ]
    expect(() => accumulateDivergence(initialDivergenceTally(), bd, 'fold')).toThrow()
  })
})

describe('summarizeDivergence', () => {
  it('decisionCount=0のときは3bucket全てuserRate:0, gtoRate:0, diff:0(ゼロ除算回避)', () => {
    const summary = summarizeDivergence(initialDivergenceTally())
    expect(summary.count).toBe(0)
    expect(summary.buckets).toEqual([
      { bucket: 'fold', userRate: 0, gtoRate: 0, diff: 0 },
      { bucket: 'passive', userRate: 0, gtoRate: 0, diff: 0 },
      { bucket: 'aggressive', userRate: 0, gtoRate: 0, diff: 0 },
    ])
  })

  it('bucketの並び順はfold, passive, aggressiveで固定', () => {
    const summary = summarizeDivergence(initialDivergenceTally())
    expect(summary.buckets.map((b) => b.bucket)).toEqual(['fold', 'passive', 'aggressive'])
  })

  it('1決断のみ: ユーザーがfold・GTOがfold寄りの分布', () => {
    const bd = breakdown({ fold: 0.6, check: 0.3, bet33: 0.1 })
    const tally = accumulateDivergence(initialDivergenceTally(), bd, 'fold')
    const summary = summarizeDivergence(tally)
    expect(summary.count).toBe(1)
    const foldBucket = summary.buckets.find((b) => b.bucket === 'fold')
    if (!foldBucket) throw new Error('fold bucket not found')
    expect(foldBucket.userRate).toBeCloseTo(1, 9) // 1決断中1回fold
    expect(foldBucket.gtoRate).toBeCloseTo(0.6, 9)
    expect(foldBucket.diff).toBeCloseTo(0.4, 9) // 実選択がGTOよりfold寄り
  })

  it('極端ケース: 全決断が同じbucket(常にaggressive)', () => {
    const bd = breakdown({ bet33: 1 })
    let tally = initialDivergenceTally()
    for (let i = 0; i < 5; i++) tally = accumulateDivergence(tally, bd, 'bet33')
    const summary = summarizeDivergence(tally)
    expect(summary.count).toBe(5)
    const aggressive = summary.buckets.find((b) => b.bucket === 'aggressive')
    const fold = summary.buckets.find((b) => b.bucket === 'fold')
    const passive = summary.buckets.find((b) => b.bucket === 'passive')
    if (!aggressive || !fold || !passive) throw new Error('bucket missing')
    expect(aggressive.userRate).toBeCloseTo(1, 9)
    expect(aggressive.gtoRate).toBeCloseTo(1, 9)
    expect(aggressive.diff).toBeCloseTo(0, 9)
    expect(fold.userRate).toBe(0)
    expect(passive.userRate).toBe(0)
  })

  it('複数決断: userRate合計≈1・gtoRate合計≈1・diff合計≈0', () => {
    let tally = initialDivergenceTally()
    tally = accumulateDivergence(tally, breakdown({ fold: 0.2, check: 0.5, bet33: 0.3 }), 'fold')
    tally = accumulateDivergence(tally, breakdown({ fold: 0.1, call: 0.4, raise55: 0.5 }), 'call')
    tally = accumulateDivergence(tally, breakdown({ fold: 0.05, check: 0.15, allin: 0.8 }), 'allin')
    tally = accumulateDivergence(tally, breakdown({ fold: 0.9, check: 0.05, bet75: 0.05 }), 'check')

    const summary = summarizeDivergence(tally)
    expect(summary.count).toBe(4)

    const userRateSum = summary.buckets.reduce((s, b) => s + b.userRate, 0)
    const gtoRateSum = summary.buckets.reduce((s, b) => s + b.gtoRate, 0)
    const diffSum = summary.buckets.reduce((s, b) => s + b.diff, 0)

    expect(userRateSum).toBeCloseTo(1, 9)
    expect(gtoRateSum).toBeCloseTo(1, 9)
    expect(diffSum).toBeCloseTo(0, 9)
  })
})

describe('数値的性質: 正規化済みbreakdownを積み上げた合計(手作りフィクスチャ)', () => {
  // grading.tsの性質(1決断につきfreq合計=1に正規化)を前提に、複数決断を集計した後も
  // gtoFreqSumの3bucket合計 === decisionCount、userCountの3bucket合計 === decisionCount
  // (整数の完全一致)となることを検証する。
  const fixtures: { bd: ActionBreakdownEntry[]; chosen: string }[] = [
    { bd: breakdown({ fold: 0.2, check: 0.5, bet33: 0.3 }), chosen: 'fold' },
    { bd: breakdown({ fold: 0.1, call: 0.4, raise55: 0.5 }), chosen: 'call' },
    { bd: breakdown({ fold: 0.05, check: 0.15, allin: 0.8 }), chosen: 'allin' },
    { bd: breakdown({ fold: 0.9, check: 0.05, bet75: 0.05 }), chosen: 'check' },
    { bd: breakdown({ fold: 0, check: 0, call: 0, bet33: 0, bet75: 0, raise55: 0, allin: 1 }), chosen: 'bet33' },
  ]

  it(`${fixtures.length}決断を積み上げるとgtoFreqSum合計===decisionCount(1e-9許容)・userCount合計===decisionCount(完全一致)`, () => {
    let tally = initialDivergenceTally()
    for (const f of fixtures) tally = accumulateDivergence(tally, f.bd, f.chosen)

    expect(tally.decisionCount).toBe(fixtures.length)
    expect(sumBuckets(tally.userCount)).toBe(fixtures.length) // 整数の完全一致
    expect(sumBuckets(tally.gtoFreqSum)).toBeCloseTo(fixtures.length, 9)
  })
})

describe('数値的性質: 実.binフィクスチャ由来の実データ', () => {
  // gradeDecisionが返す実際のactionBreakdownを多数の(実際に配られた)コンボについて
  // 積み上げ、同じ数値的性質を確認する。フィクスチャのfreqはFloat32格納由来の量子化
  // 誤差を持つため(実測: freq合計は1決断あたり最大約0.004ずれる。1決断あたりの
  // 理論上の完全な正規化ではなく.binのエンコード精度に起因)、決断数に応じた許容誤差
  // (0.01 * decisionCount)を使う。
  let solution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb/KcJc2c.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)
  })

  it('実際に配られたコンボ(freq合計が1に近い)を積み上げるとgtoFreqSum合計≈decisionCount・userCount合計===decisionCount', () => {
    const root = solution.nodes.get('')
    if (!root) throw new Error('root node not found in fixture')
    const handCount = solution.oopCombos.length

    let tally = initialDivergenceTally()
    let decisionCount = 0
    for (let h = 0; h < handCount; h++) {
      let freqSum = 0
      for (let a = 0; a < root.actionLabels.length; a++) freqSum += root.freqs[a * handCount + h]
      if (freqSum < 0.9) continue // レンジ外/ブロックされたコンボは対象外(grading.test.ts同様)

      // 実際のユーザー選択の代わりに、そのコンボの最頻度アクションを「選んだ」ことにして
      // 積み上げる(数値的性質の検証が目的で、採点結果自体は今回対象外のため)。
      const result = gradeDecision(root, h, root.actionLabels[0])
      tally = accumulateDivergence(tally, result.actionBreakdown, result.actionBreakdown[0].label)
      decisionCount++
    }

    expect(decisionCount).toBeGreaterThan(100) // フィルタが機能して十分な件数を検査できている
    expect(tally.decisionCount).toBe(decisionCount)
    expect(sumBuckets(tally.userCount)).toBe(decisionCount) // 整数の完全一致
    expect(Math.abs(sumBuckets(tally.gtoFreqSum) - decisionCount)).toBeLessThan(0.01 * decisionCount)

    const summary = summarizeDivergence(tally)
    const userRateSum = summary.buckets.reduce((s, b) => s + b.userRate, 0)
    const gtoRateSum = summary.buckets.reduce((s, b) => s + b.gtoRate, 0)
    const diffSum = summary.buckets.reduce((s, b) => s + b.diff, 0)
    expect(userRateSum).toBeCloseTo(1, 9)
    expect(gtoRateSum).toBeCloseTo(1, 2) // 量子化誤差を含むため粗めの許容誤差
    expect(Math.abs(diffSum)).toBeLessThan(0.01)
  })
})
