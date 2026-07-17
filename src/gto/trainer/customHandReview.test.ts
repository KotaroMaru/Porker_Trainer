/// <reference types="node" />
// NF1: computeCustomHandReview(バッチ処理版)の統合テスト。実.binフィクスチャ
// (srp_btn_vs_bb/AsQsJs)+createInProcessProviderFactoryを使い、fullHandFlow.test.tsと
// 同じ手法(fixedRng)でFullHandControllerを実際にインタラクティブに進行させた結果を
// 「正解」とし、その同一アクション列をcomputeCustomHandReviewへ渡して再現させた結果と
// 数値的に(1e-6程度の許容誤差で)一致することを検証する(GTOドメイン最重要ルール:
// 独立経路での再現一致確認)。
//
// 両経路を1e-6で一致させるため、FullHandController側もcomputeCustomHandReview側と
// 同じ精密設定(300反復・目標exploitability 0.005)で一発ソルブするテスト用ファクトリ
// (makePreciseFactory)を使う。本番のTURN_PLAY_SOLVE→バックグラウンドrefineという
// 2段階ソルブのままだと、チェックポイント粒度の違いで収束の停止反復がズレ、
// 比較が意味を持たなくなるため。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FullHandController, type FullHandSnapshot } from './fullHandFlow'
import { computeCustomHandReview, type CustomHandInput } from './customHandReview'
import { createInProcessProviderFactory } from './inProcessProviderFactory'
import type { NodeProviderFactory, StreetSolveInput } from './nodeDataProvider'
import type { ReviewData, ReviewDecision } from './reviewBuilder'
import type { Seat } from './gameFlow'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import { cardKey } from '../../engine/deck'
import type { Card } from '../../engine/types'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

/** fullHandFlow.test.tsと同じ「userTurn/overまで待つ」ヘルパー。 */
function createWaiter() {
  let latest: FullHandSnapshot | null = null
  let pending = false
  let waitingResolve: (() => void) | null = null
  const onUpdate = (snap: FullHandSnapshot) => {
    latest = snap
    if (snap.phase === 'userTurn' || snap.phase === 'over') {
      pending = true
      if (waitingResolve) {
        const r = waitingResolve
        waitingResolve = null
        r()
      }
    }
  }
  async function waitForPause(): Promise<FullHandSnapshot> {
    if (pending) {
      pending = false
      return latest!
    }
    await new Promise<void>((resolve) => {
      waitingResolve = resolve
    })
    pending = false
    return latest!
  }
  return { onUpdate, waitForPause }
}

// computeCustomHandReviewはloadFlopSolution経由(fetch)でフロップ解を取得するため、
// store.test.tsと同じ手法でglobalThis.fetchを実.binファイルへスタブする。
const originalFetch = globalThis.fetch
const binFetchStub = (async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input.toString()
  const match = url.match(/\/gto\/solutions\/([^/]+)\/([^/]+)\.bin$/)
  if (!match) throw new Error(`unexpected fetch url in test stub: ${url}`)
  const [, scenarioId, flopId] = match
  const filePath = join(process.cwd(), 'public/gto/solutions', scenarioId, `${flopId}.bin`)
  const buf = await readFile(filePath)
  const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Response(arrayBuf, { status: 200 })
}) as typeof fetch

beforeAll(() => {
  globalThis.fetch = binFetchStub
})
afterAll(() => {
  globalThis.fetch = originalFetch
})

describe('computeCustomHandReview (実.binフィクスチャ+in-processファクトリによる数値交差検証)', () => {
  const scenario = getScenario('srp_btn_vs_bb')
  const flop = FLOPS.find((f) => f.cards.join('') === FLOP_STR)
  if (!flop) throw new Error(`flop fixture not found in flops.json: ${FLOP_STR}`)
  let flopSolution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb', `${FLOP_STR}.bin`)
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    flopSolution = decodeSolutionFile(arrayBuf)
  })

  /**
   * computeCustomHandReviewのPRECISE_LIVE_SOLVEと同じ設定({maxIterations:300,
   * targetExploitability:0.005, checkEveryIterations:50})で、FullHandController側の
   * ターン/リバーも最初から一発ソルブし、refine()はno-opにする(既に精密なので不要)。
   * CFRは反復回数だけに依存する決定的な計算(rng不使用)なので、同一street入力
   * (board/pot/stack/reach)であれば、この設定で解いたFullHandController側と
   * computeCustomHandReview側は同一の最終戦略に到達するはず。
   */
  function makePreciseFactory(): NodeProviderFactory {
    const inner = createInProcessProviderFactory()
    return {
      forFlop: (solution, board) => inner.forFlop(solution, board),
      forLiveStreet: (input: StreetSolveInput) => {
        const preciseInput: StreetSolveInput = { ...input, maxIterations: 300, targetExploitability: 0.005, checkEveryIterations: 50 }
        const real = inner.forLiveStreet(preciseInput)
        return { ...real, refine: () => {} }
      },
      dispose: () => inner.dispose(),
    }
  }

  /** ReviewData.history(preflop除く)から、ストリートごとのCustomStreetAction[]を復元する。 */
  function actionsFromHistory(review: ReviewData, userSeat: Seat, botSeat: Seat): CustomHandInput['streetActions'] {
    const out: CustomHandInput['streetActions'] = { flop: [], turn: [], river: [] }
    for (const entry of review.history) {
      if (entry.street === 'preflop') continue
      out[entry.street].push({ seat: entry.isUserDecision ? userSeat : botSeat, label: entry.label })
    }
    return out
  }

  function expectCloseArray(actual: ArrayLike<number>, expected: ArrayLike<number>, msg: string): void {
    expect(actual.length, `${msg}: length`).toBe(expected.length)
    for (let i = 0; i < actual.length; i++) expect(actual[i], `${msg}[${i}]`).toBeCloseTo(expected[i], 6)
  }

  function expectCardsEqual(actual: Card[], expected: Card[], msg: string): void {
    expect(actual.map(cardKey), msg).toEqual(expected.map(cardKey))
  }

  /** 2つのReviewDecisionが1e-6程度の許容誤差で数値的に一致することを検証する。 */
  function expectDecisionsMatch(actual: ReviewDecision, expected: ReviewDecision, idx: number): void {
    const msg = `decisions[${idx}]`
    expect(actual.street, `${msg}.street`).toBe(expected.street)
    expect(actual.seat, `${msg}.seat`).toBe(expected.seat)
    expect(actual.chosenLabel, `${msg}.chosenLabel`).toBe(expected.chosenLabel)
    expectCardsEqual(actual.boardAtDecision, expected.boardAtDecision, `${msg}.boardAtDecision`)
    expect(actual.potBbAtDecision, `${msg}.potBbAtDecision`).toBeCloseTo(expected.potBbAtDecision, 6)
    expect(actual.effectiveStackRemainingBb, `${msg}.effectiveStackRemainingBb`).toBeCloseTo(expected.effectiveStackRemainingBb, 6)

    expect(actual.grading.verdict, `${msg}.grading.verdict`).toBe(expected.grading.verdict)
    expect(actual.grading.bestLabel, `${msg}.grading.bestLabel`).toBe(expected.grading.bestLabel)
    expect(actual.grading.evLossBb, `${msg}.grading.evLossBb`).toBeCloseTo(expected.grading.evLossBb, 6)
    expect(actual.grading.bestEvBb, `${msg}.grading.bestEvBb`).toBeCloseTo(expected.grading.bestEvBb, 6)
    expect(actual.grading.chosenEvBb, `${msg}.grading.chosenEvBb`).toBeCloseTo(expected.grading.chosenEvBb, 6)
    expect(actual.grading.actionBreakdown.length, `${msg}.grading.actionBreakdown.length`).toBe(expected.grading.actionBreakdown.length)
    for (let i = 0; i < actual.grading.actionBreakdown.length; i++) {
      expect(actual.grading.actionBreakdown[i].label, `${msg}.grading.actionBreakdown[${i}].label`).toBe(expected.grading.actionBreakdown[i].label)
      expect(actual.grading.actionBreakdown[i].freq, `${msg}.grading.actionBreakdown[${i}].freq`).toBeCloseTo(expected.grading.actionBreakdown[i].freq, 6)
      expect(actual.grading.actionBreakdown[i].evBb, `${msg}.grading.actionBreakdown[${i}].evBb`).toBeCloseTo(expected.grading.actionBreakdown[i].evBb, 6)
    }

    expectCloseArray(actual.heroWeights, expected.heroWeights, `${msg}.heroWeights`)
    expectCloseArray(actual.villainWeights, expected.villainWeights, `${msg}.villainWeights`)
    expectCardsEqual(actual.heroCombos.flat(), expected.heroCombos.flat(), `${msg}.heroCombos`)
    expectCardsEqual(actual.villainCombos.flat(), expected.villainCombos.flat(), `${msg}.villainCombos`)

    expect(
      actual.responseNodes.map((r) => r.forLabel),
      `${msg}.responseNodes.forLabel`,
    ).toEqual(expected.responseNodes.map((r) => r.forLabel))
    for (let i = 0; i < actual.responseNodes.length; i++) {
      expectCloseArray(actual.responseNodes[i].node.freqs, expected.responseNodes[i].node.freqs, `${msg}.responseNodes[${i}].freqs`)
      expectCloseArray(actual.responseNodes[i].node.evsBb, expected.responseNodes[i].node.evsBb, `${msg}.responseNodes[${i}].evsBb`)
    }
  }

  it('フロップ→ターン→リバー(ショーダウン到達)の再現一致: FullHandControllerを実際に進行させた結果とcomputeCustomHandReviewの結果がgrading/EVロス/レンジ重みまで1e-6許容誤差で一致する', async () => {
    const userSeat: Seat = 0
    const botSeat: Seat = 1
    // check-checkのみで進行させ、フォールド・オールインなしでリバーまで到達する
    // (fullHandFlow.test.tsの同名パターンと同じ手法)。
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat,
      rng,
      providerFactory: makePreciseFactory(),
      onUpdate: waiter.onUpdate,
      onError: (err) => {
        throw err
      },
    })
    controller.start()

    let snap = await waiter.waitForPause()
    while (snap.phase !== 'over') {
      controller.chooseAction('check')
      snap = await waiter.waitForPause()
    }
    expect(snap.result!.endedBy).toBe('showdown')
    expect(snap.board.length).toBe(5)

    const interactiveReview = controller.getReview()
    controller.dispose()

    const input: CustomHandInput = {
      scenario,
      flop,
      turnCard: interactiveReview.board[3],
      riverCard: interactiveReview.board[4],
      userSeat,
      userCombo: interactiveReview.userCombo,
      streetActions: actionsFromHistory(interactiveReview, userSeat, botSeat),
    }

    const batchReview = await computeCustomHandReview(input, makePreciseFactory())

    expect(batchReview.decisions.length).toBe(3)
    expect(batchReview.decisions.length).toBe(interactiveReview.decisions.length)
    for (let i = 0; i < batchReview.decisions.length; i++) {
      expectDecisionsMatch(batchReview.decisions[i], interactiveReview.decisions[i], i)
    }
    expectCardsEqual(batchReview.board, interactiveReview.board, 'board')
    expect(batchReview.userPosition).toBe(interactiveReview.userPosition)
    expect(batchReview.botPosition).toBe(interactiveReview.botPosition)
  }, 180_000)

  it('フロップでフォールドして終わるケースの再現一致(turn/riverアクションは空、ターン/リバーのカードもnull)', async () => {
    const userSeat: Seat = 1
    const botSeat: Seat = 0
    // fullHandFlow.test.tsの「フロップでボットがベットし、ユーザーがfoldする」パターンと同じ
    // rng選択(累積和サンプリングの性質上、最大サイズのベット系を選ばせてからfoldする)。
    const rng = fixedRng([0.999999])
    const waiter = createWaiter()
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat,
      rng,
      providerFactory: makePreciseFactory(),
      onUpdate: waiter.onUpdate,
      onError: (err) => {
        throw err
      },
    })
    controller.start()

    const snap1 = await waiter.waitForPause()
    expect(snap1.phase).toBe('userTurn')
    expect(snap1.street).toBe('flop')
    controller.chooseAction('fold')
    const final = await waiter.waitForPause()
    expect(final.phase).toBe('over')
    expect(final.result!.endedBy).toBe('fold')
    expect(final.board.length).toBe(3)

    const interactiveReview = controller.getReview()
    controller.dispose()

    const streetActions = actionsFromHistory(interactiveReview, userSeat, botSeat)
    expect(streetActions.turn.length).toBe(0)
    expect(streetActions.river.length).toBe(0)

    const input: CustomHandInput = {
      scenario,
      flop,
      turnCard: null,
      riverCard: null,
      userSeat,
      userCombo: interactiveReview.userCombo,
      streetActions,
    }

    const batchReview = await computeCustomHandReview(input, makePreciseFactory())

    expect(batchReview.decisions.length).toBe(interactiveReview.decisions.length)
    for (let i = 0; i < batchReview.decisions.length; i++) {
      expectDecisionsMatch(batchReview.decisions[i], interactiveReview.decisions[i], i)
    }
    expectCardsEqual(batchReview.board, interactiveReview.board, 'board')
  }, 60_000)

  describe('不正な入力アクション列', () => {
    const userSeat: Seat = 0
    const baseInput = (streetActions: CustomHandInput['streetActions']): CustomHandInput => ({
      scenario,
      flop,
      turnCard: null,
      riverCard: null,
      userSeat,
      userCombo: flopSolution.oopCombos[0],
      streetActions,
    })

    it('存在しないアクションラベルはthrowする', async () => {
      const input = baseInput({ flop: [{ seat: 0, label: 'not-a-real-label' }], turn: [], river: [] })
      await expect(computeCustomHandReview(input, makePreciseFactory())).rejects.toThrow(/unknown action label/)
    })

    it('手番違反(actingPlayerと一致しないseat)はthrowする', async () => {
      // firstToActは常に0(OOP)。root決断でseat:1を渡すのは手番違反。
      const input = baseInput({ flop: [{ seat: 1, label: 'check' }], turn: [], river: [] })
      await expect(computeCustomHandReview(input, makePreciseFactory())).rejects.toThrow(/acting-player mismatch/)
    })

    it('フォールド後に続くアクションはthrowする', async () => {
      const input = baseInput({
        flop: [
          { seat: 0, label: 'bet33' },
          { seat: 1, label: 'fold' },
          { seat: 0, label: 'check' }, // フォールドで既に終わっているのに続くアクション
        ],
        turn: [],
        river: [],
      })
      await expect(computeCustomHandReview(input, makePreciseFactory())).rejects.toThrow(/extra action after the hand already ended/)
    })

    it('フォールドで終わったのにturn/riverアクションが非空だとthrowする', async () => {
      const input = baseInput({
        flop: [
          { seat: 0, label: 'bet33' },
          { seat: 1, label: 'fold' },
        ],
        turn: [{ seat: 0, label: 'check' }],
        river: [],
      })
      await expect(computeCustomHandReview(input, makePreciseFactory())).rejects.toThrow(/turn\/river streetActions are non-empty/)
    })

    it('ストリートが未完(木がdecisionノードのまま)だとthrowする', async () => {
      const input = baseInput({ flop: [{ seat: 0, label: 'bet33' }], turn: [], river: [] })
      await expect(computeCustomHandReview(input, makePreciseFactory())).rejects.toThrow(/is incomplete/)
    })
  })
})
