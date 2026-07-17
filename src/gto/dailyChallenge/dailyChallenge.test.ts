/// <reference types="node" />
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FLOPS, pickWeightedFlop } from '../data/flops'
import { SCENARIOS, getScenario, pickWeightedScenario } from '../data/scenarios'
import { aggregateDailyAnswer, applyDailyResultToRank, computeDailyScore, pickDailySpotSeeds, DAILY_RATING_INITIAL } from './dailyChallenge'
import { createSeededRng } from './seededRng'
import { loadDailyRank, loadDailyResults, saveDailyRank, saveDailyResult } from './storage'
import { FullHandController, type FullHandSnapshot } from '../trainer/fullHandFlow'
import { createInProcessProviderFactory } from '../trainer/inProcessProviderFactory'
import type { NodeProviderFactory } from '../trainer/nodeDataProvider'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { cardKey } from '../../engine/deck'
import type { GradeVerdict } from '../trainer/grading'
import type { ReviewDecision } from '../trainer/reviewBuilder'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: (key) => void values.delete(key), clear: () => values.clear(), key: (index) => [...values.keys()][index] ?? null, get length() { return values.size } } as Storage
}

describe('daily challenge deterministic selection', () => {
  it('同じseedは同じ乱数列を返す', () => {
    const first = createSeededRng('2026-07-17')
    const second = createSeededRng('2026-07-17')
    expect(Array.from({ length: 8 }, first)).toEqual(Array.from({ length: 8 }, second))
  })

  it('同じ日付は同じシナリオ・フロップ列、別日は異なる列を作る', () => {
    const select = (date: string) => pickDailySpotSeeds(date, 10).map((seed) => `${pickWeightedScenario(SCENARIOS, seed.scenarioRng).id}/${pickWeightedFlop(FLOPS, seed.flopRng).cards.join('')}`)
    expect(select('2026-07-17')).toEqual(select('2026-07-17'))
    expect(select('2026-07-17')).not.toEqual(select('2026-07-18'))
  })

  it('重み付き抽選は注入したrngに従い、デフォルトもプールから返す', () => {
    expect(pickWeightedScenario(SCENARIOS, () => 0)).toBe(SCENARIOS[0])
    expect(pickWeightedFlop(FLOPS, () => 0)).toBe(FLOPS[0])
    expect(SCENARIOS).toContain(pickWeightedScenario())
    expect(FLOPS).toContain(pickWeightedFlop())
  })

  it('スコアを0〜100に収め、ランク変動を±10へ制限する', () => {
    const score = computeDailyScore([{ verdict: 'correct', evLossBb: 0 }, { verdict: 'marginal', evLossBb: 1 }, { verdict: 'incorrect', evLossBb: 10 }])
    expect(score.correctCount).toBe(1)
    expect(score.totalEvLossBb).toBe(11)
    expect(score.score).toBeGreaterThanOrEqual(0)
    expect(score.score).toBeLessThanOrEqual(100)
    expect(applyDailyResultToRank(1000, 100) - 1000).toBeLessThanOrEqual(10)
    expect(applyDailyResultToRank(1000, 0) - 1000).toBeGreaterThanOrEqual(-10)
  })
})

describe('daily challenge storage', () => {
  const original = globalThis.localStorage
  afterEach(() => Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true }))

  it('日別結果とランクを永続化し、未対応環境では既定値へ戻る', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
    saveDailyResult('2026-07-17', { score: 80, correctCount: 8, totalEvLossBb: 1.5, handCount: 10 })
    saveDailyRank(1008)
    expect(loadDailyResults()['2026-07-17']).toMatchObject({ score: 80, correctCount: 8 })
    expect(loadDailyRank()).toBe(1008)
  })

  it('未保存(初回アクセス)ではDAILY_RATING_INITIALを返す(Number(null)===0による誤フォールバック回避)', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
    expect(loadDailyRank()).toBe(DAILY_RATING_INITIAL)
  })
})

// P11 Phase C: aggregateDailyAnswer — 通しモードの1ハンド(複数決断)を単発と同じ
// 「1回答」形式へ集約するロジック。GradeResult以外の広範なReviewDecisionフィールドは
// このロジックに無関係なため、最小限のfixtureへキャストして検証する。
function fakeDecision(verdict: GradeVerdict, evLossBb: number): ReviewDecision {
  return { grading: { verdict, evLossBb, bestLabel: 'bet33', bestEvBb: 0, chosenEvBb: 0, actionBreakdown: [] } } as unknown as ReviewDecision
}

describe('aggregateDailyAnswer (P11 Phase C)', () => {
  it('全て正解ならverdict:correct、evLossBbは合計になる', () => {
    const result = aggregateDailyAnswer([fakeDecision('correct', 0), fakeDecision('correct', 0.01)])
    expect(result.verdict).toBe('correct')
    expect(result.evLossBb).toBeCloseTo(0.01)
  })

  it('marginalが1つでもあり、incorrectが無ければ全体としてmarginal', () => {
    const result = aggregateDailyAnswer([fakeDecision('correct', 0), fakeDecision('marginal', 0.2)])
    expect(result.verdict).toBe('marginal')
    expect(result.evLossBb).toBeCloseTo(0.2)
  })

  it('incorrectが1つでも混在すれば全体としてincorrect(最悪判定を採用)、evLossBbは全決断の合計(負値は切り捨て)', () => {
    const result = aggregateDailyAnswer([fakeDecision('correct', 0), fakeDecision('marginal', 0.5), fakeDecision('incorrect', 2), fakeDecision('correct', -0.3)])
    expect(result.verdict).toBe('incorrect')
    expect(result.evLossBb).toBeCloseTo(2.5) // -0.3はMath.max(0, ...)により0として扱われる
  })

  it('決断が0件ならcorrect/evLossBb:0を返す(ユーザーの手番が来る前にボットがフォールドした場合等の安全策)', () => {
    expect(aggregateDailyAnswer([])).toEqual({ verdict: 'correct', evLossBb: 0 })
  })
})

// P11 Phase C: 通しモードの決定性検証(このタスクで最も重要な検証項目)。
// 同一dateKeyのhandRngから独立に構築した2つのFullHandControllerが、同じシナリオ・
// 同じフロップ(固定フィクスチャ)・同じ配牌・同じボット行動系列・同じ結果になることを、
// 実.binフィクスチャ+createInProcessProviderFactory(軽量化したCFRソルブ)で検証する。
// パターンはfullHandFlow.test.tsの統合テストに倣う。
describe('daily challenge full-mode determinism (handRng, P11 Phase C)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const FLOP_STR = 'AsQsJs'
  const flop = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flop) throw new Error(`flop fixture not found in flops.json: ${FLOP_STR}`)
  let flopSolution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', `${FLOP_STR}.bin`)
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    flopSolution = decodeSolutionFile(arrayBuf)
  })

  function makeFactory(): NodeProviderFactory {
    const inner = createInProcessProviderFactory({ maxIterations: 15, targetExploitability: 0.1 })
    return {
      forFlop: (solution, board) => inner.forFlop(solution, board),
      forLiveStreet: (input) => {
        const real = inner.forLiveStreet(input)
        return {
          ...real,
          // 本番の300反復を同期実行すると各ハンドが数十秒停止するため、テストでは
          // 同一セッションを追加5反復だけ確実に進める(fullHandFlow.test.tsと同じ軽量化)。
          refine: () => real.refine({ maxIterations: 20, targetExploitability: 0, chunkIterations: 5 }),
        }
      },
      dispose: () => inner.dispose(),
    }
  }

  /** userTurn中はcheckを優先(無ければ最初の選択肢)して選び続け、overに到達するまで進める。 */
  async function runHandToCompletion(rng: () => number, userSeat: 0 | 1): Promise<{ snap: FullHandSnapshot; review: ReturnType<FullHandController['getReview']> }> {
    let resolvePause: ((snap: FullHandSnapshot) => void) | null = null
    let pauseSnap: FullHandSnapshot | null = null
    const onUpdate = (snap: FullHandSnapshot) => {
      if (snap.phase === 'userTurn' || snap.phase === 'over') {
        pauseSnap = snap
        if (resolvePause) {
          const r = resolvePause
          resolvePause = null
          r(snap)
        }
      }
    }
    function waitForPause(): Promise<FullHandSnapshot> {
      if (pauseSnap) {
        const s = pauseSnap
        pauseSnap = null
        return Promise.resolve(s)
      }
      return new Promise((resolve) => {
        resolvePause = resolve
      })
    }
    const controller = new FullHandController({
      scenario,
      flop: flop!, // 事前のif (!flop) throwで存在確認済み(TSの閉包内narrowing制限を回避)
      flopSolution,
      userSeat,
      rng,
      providerFactory: makeFactory(),
      onUpdate,
      onError: (err) => {
        throw err
      },
    })
    controller.start()
    let snap = await waitForPause()
    let guard = 0
    while (snap.phase !== 'over') {
      guard++
      if (guard > 15) throw new Error('too many user decisions, possible infinite loop')
      const label = snap.actionsWithAmounts.find((a) => a.label === 'check')?.label ?? snap.actionsWithAmounts[0].label
      controller.chooseAction(label)
      snap = await waitForPause()
    }
    const review = controller.getReview()
    controller.dispose()
    return { snap, review }
  }

  it('同一dateKeyのhandRngから2回独立に構築したFullHandControllerは、同じ配牌・同じボード・同じアクション系列・同じ結果になる', async () => {
    const seedsA = pickDailySpotSeeds('2026-07-17', 3)[0]
    const seedsB = pickDailySpotSeeds('2026-07-17', 3)[0]
    // seatRngはscenarioRng/flopRngと同様にhandRngとは独立した系列なので、ここでは
    // 固定のuserSeatを使ってhandRng単体の決定性だけを検証する。
    const a = await runHandToCompletion(seedsA.handRng, 0)
    const b = await runHandToCompletion(seedsB.handRng, 0)

    expect(a.review.userCombo).toEqual(b.review.userCombo)
    expect(a.snap.board.map(cardKey)).toEqual(b.snap.board.map(cardKey))
    expect(a.review.decisions.map((d) => d.chosenLabel)).toEqual(b.review.decisions.map((d) => d.chosenLabel))
    expect(a.review.decisions.map((d) => d.street)).toEqual(b.review.decisions.map((d) => d.street))
    expect(a.snap.result?.endedBy).toEqual(b.snap.result?.endedBy)
    expect(a.snap.result?.userNetBb).toEqual(b.snap.result?.userNetBb)
  }, 60_000)

  it('別のdateKeyのhandRngは異なる配牌・アクション系列になる', async () => {
    const seedsX = pickDailySpotSeeds('2026-07-17', 3)[0]
    const seedsY = pickDailySpotSeeds('2026-07-18', 3)[0]
    const x = await runHandToCompletion(seedsX.handRng, 0)
    const y = await runHandToCompletion(seedsY.handRng, 0)

    const same =
      JSON.stringify(x.review.userCombo) === JSON.stringify(y.review.userCombo) &&
      x.snap.board.map(cardKey).join(',') === y.snap.board.map(cardKey).join(',') &&
      x.review.decisions.map((d) => d.chosenLabel).join(',') === y.review.decisions.map((d) => d.chosenLabel).join(',')
    expect(same).toBe(false)
  }, 60_000)
})
