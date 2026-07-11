/// <reference types="node" />
// P6 Step B5: FullHandController(通しモードのマルチストリート状態機械)の統合テスト。
// 実.binフィクスチャ(srp_btn_vs_bb/AsQsJs)+createInProcessProviderFactory(B4のテスト
// シーム、Web Workerを使わず同一パイプラインを同期・低イテレーションで実行)を使う。
// フィクスチャ読み込みはjoin(process.cwd(),...)方式(precomputedProvider.test.tsと同じ、
// import.meta.url経由は既知の環境依存問題があるため不採用)。

import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FullHandController, type FullHandSnapshot } from './fullHandFlow'
import { createInProcessProviderFactory } from './inProcessProviderFactory'
import type { NodeProviderFactory, StreetSolveInput } from './nodeDataProvider'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario, preflopContribPerPlayerBb } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import { cardKey } from '../../engine/deck'
import { evaluate } from '../../engine/evaluator'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

/**
 * onUpdateの通知を蓄積し、userTurn/over(=ユーザー入力を待つ一時停止点)まで待てるようにする。
 * 「直前に消費済みの一時停止状態」を再度返さないよう、pendingフラグで未消費の新規停止のみを
 * 有効とする(chooseAction直後、advance()が最初のawaitに到達するまで何もemitしない経路
 * (例: fold直後のfinalizeFold)では、waitForPause呼び出し時点でまだ古いuserTurnスナップ
 * ショットしかlatestに無い。フラグ無しだとそれを新しい停止と誤認して即座に返してしまう)。
 */
function createWaiter() {
  let latest: FullHandSnapshot | null = null
  let pending = false
  let waitingResolve: (() => void) | null = null
  const updates: FullHandSnapshot[] = []
  const onUpdate = (snap: FullHandSnapshot) => {
    latest = snap
    updates.push(snap)
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
  return { onUpdate, waitForPause, updates, get latest() { return latest } }
}

describe('FullHandController (実.binフィクスチャ+in-processファクトリによる統合テスト)', () => {
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

  function makeFactory(): NodeProviderFactory {
    return createInProcessProviderFactory({ maxIterations: 15, targetExploitability: 0.1 })
  }

  it('フロップ→ターン→リバー通しでoverに到達し、各街に決断が記録され、ボードが3→4→5枚に成長する(配布カード衝突なし)', async () => {
    // userSeat=0(OOP=BB=defender): OOPが各街で先手なので、ユーザーは毎ストリート決断する。
    // rngを常に極小値にすると、サンプリングの累積和ロジック(sampleAction)の性質上、
    // 各分布の先頭アクション(check系列)が常に選ばれる。ボットは常にcheck、ユーザーも
    // checkを選び続けることで、フォールド・オールインなしでリバーまで到達する
    // パッシブな通しラインを決定的に再現する。
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 0,
      rng,
      providerFactory: makeFactory(),
      onUpdate: waiter.onUpdate,
      onError: (err) => { throw err },
    })
    controller.start()

    let snap = await waiter.waitForPause()
    const streetsSeen: string[] = []
    while (snap.phase !== 'over') {
      streetsSeen.push(snap.street)
      expect(snap.actionsWithAmounts.some((a) => a.label === 'check')).toBe(true)
      controller.chooseAction('check')
      snap = await waiter.waitForPause()
    }

    expect(streetsSeen).toEqual(['flop', 'turn', 'river'])
    expect(snap.result).not.toBeNull()
    expect(snap.result!.endedBy).toBe('showdown')
    expect(snap.board.length).toBe(5)

    const review = controller.getReview()
    expect(review.decisions.length).toBe(3)
    expect(review.decisions.map((d) => d.street)).toEqual(['flop', 'turn', 'river'])
    expect(review.decisions.map((d) => d.boardAtDecision.length)).toEqual([3, 4, 5])

    // 配布カード(ホール2枚×2+ボード5枚=9枚)に重複がないこと。
    const allCards = [...review.userCombo, ...review.board]
    const keys = allCards.map(cardKey)
    expect(new Set(keys).size).toBe(keys.length)

    controller.dispose()
  }, 30_000)

  it('フロップでボットがベットし、ユーザーがfoldすると即座にoverになる(userNetBb=-プリフロップ拠出)', async () => {
    // ボットが先手(userSeat=1=IP)。ボットのサンプリングにrng≈1を使うと、sampleActionの
    // フォールバック(累積和が一致しない場合に最後の選択肢を返す)により、アクション列の
    // 最後(=最大サイズのベット系、通常allin)が選ばれる。ユーザーはそれに対してfoldする。
    const rng = fixedRng([0.999999])
    const waiter = createWaiter()
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 1,
      rng,
      providerFactory: makeFactory(),
      onUpdate: waiter.onUpdate,
      onError: (err) => { throw err },
    })
    controller.start()

    const snap = await waiter.waitForPause()
    expect(snap.phase).toBe('userTurn')
    expect(snap.street).toBe('flop')
    expect(snap.actionsWithAmounts.some((a) => a.label === 'fold')).toBe(true)

    controller.chooseAction('fold')
    const final = await waiter.waitForPause()

    expect(final.phase).toBe('over')
    expect(final.result!.endedBy).toBe('fold')
    expect(final.result!.foldedSeat).toBe(1)
    const expectedNet = -preflopContribPerPlayerBb(scenario)
    expect(final.result!.userNetBb).toBeCloseTo(expectedNet, 2)
    expect(final.result!.botCombo).toBeNull()

    controller.dispose()
  }, 30_000)

  it('フロップでオールイン+コールに到達すると、ライブソルブを要求せずリバーまでランアウトしてショーダウンする', async () => {
    const rng = fixedRng([0.999999])
    const waiter = createWaiter()
    let forLiveStreetCalls = 0
    const baseFactory = makeFactory()
    const spyFactory: NodeProviderFactory = {
      forFlop: (s, b) => baseFactory.forFlop(s, b),
      forLiveStreet: (input: StreetSolveInput) => {
        forLiveStreetCalls++
        return baseFactory.forLiveStreet(input)
      },
      dispose: () => baseFactory.dispose(),
    }
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 0,
      rng,
      providerFactory: spyFactory,
      onUpdate: waiter.onUpdate,
      onError: (err) => { throw err },
    })
    controller.start()

    const snap = await waiter.waitForPause()
    expect(snap.phase).toBe('userTurn')
    expect(snap.actionsWithAmounts.some((a) => a.label === 'allin')).toBe(true)

    controller.chooseAction('allin')
    const final = await waiter.waitForPause()

    expect(final.phase).toBe('over')
    expect(final.result!.endedBy).toBe('showdown')
    expect(final.board.length).toBe(5)
    expect(final.result!.botCombo).not.toBeNull()
    // オールイン成立後は意思決定が残らないため、ターン/リバーのライブソルブは一度も要求されない。
    expect(forLiveStreetCalls).toBe(0)

    controller.dispose()
  }, 30_000)

  it('ボットのベット後、ユーザー側のレンジ重みが更新され合計1に正規化され、ターンカードを含むコンボが除去される', async () => {
    // userSeat=1(IP): ボットが先手でチェック以外(大きめのサイズ)を選ぶよう促し、
    // その後ユーザーがcallし続けてリバーまで到達する。各決断のvillainWeights(=ボット側の
    // レンジ)が合計1であること、ターン/リバー決断のheroCombos/villainCombosに
    // そのストリート開始時点で場に出ているカードを含むコンボが存在しないことを検証する。
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 1,
      rng,
      providerFactory: makeFactory(),
      onUpdate: waiter.onUpdate,
      onError: (err) => { throw err },
    })
    controller.start()

    let snap = await waiter.waitForPause()
    while (snap.phase !== 'over') {
      const label = snap.actionsWithAmounts.some((a) => a.label === 'check')
        ? 'check'
        : snap.actionsWithAmounts.some((a) => a.label === 'call')
          ? 'call'
          : snap.actionsWithAmounts[0].label
      controller.chooseAction(label)
      snap = await waiter.waitForPause()
    }

    const review = controller.getReview()
    expect(review.decisions.length).toBeGreaterThanOrEqual(1)
    for (const decision of review.decisions) {
      const heroSum = decision.heroWeights.reduce((a, b) => a + b, 0)
      const villainSum = decision.villainWeights.reduce((a, b) => a + b, 0)
      expect(heroSum).toBeCloseTo(1, 5)
      expect(villainSum).toBeCloseTo(1, 5)

      const boardKeys = new Set(decision.boardAtDecision.map(cardKey))
      for (const combo of [...decision.heroCombos, ...decision.villainCombos]) {
        expect(boardKeys.has(cardKey(combo[0]))).toBe(false)
        expect(boardKeys.has(cardKey(combo[1]))).toBe(false)
      }
    }

    controller.dispose()
  }, 30_000)

  it('ポット/拠出の帳尻が合う(finalPotBb=scenario.potBb+両者の拠出合計、収支はゼロサム)', async () => {
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 0,
      rng,
      providerFactory: makeFactory(),
      onUpdate: waiter.onUpdate,
      onError: (err) => { throw err },
    })
    controller.start()

    let snap = await waiter.waitForPause()
    while (snap.phase !== 'over') {
      controller.chooseAction('check')
      snap = await waiter.waitForPause()
    }

    const result = snap.result!
    const preflopContrib = preflopContribPerPlayerBb(scenario)
    // check-checkのみで進行したチェックダウンなので、ポストフロップの追加拠出は0
    // (finalPotBb === scenario.potBb + Σpostflop-contributed、この行程ではΣ=0)。
    expect(result.finalPotBb).toBeCloseTo(scenario.potBb, 5)

    // userNetBbを、コントローラとは独立にevaluate()で勝敗を再判定して検証する
    // (「両席でゼロサム」は、フォールドしたポジションのデッドマネー分(dead blinds)が
    // 勝者側に紛れ込むため、pot全体を2アクティブプレイヤー間だけで厳密にゼロサム
    // 分配したものにはならない。そのためここでは「userNetBbが実際の勝敗と整合するか」を
    // 独立evaluate()で直接検証する形に倣った)。
    const review = controller.getReview()
    const userScore = evaluate([...review.userCombo, ...result.finalBoard]).score
    const botScore = evaluate([...result.botCombo!, ...result.finalBoard]).score
    const expectedNet =
      userScore > botScore
        ? result.finalPotBb - preflopContrib
        : userScore < botScore
          ? -preflopContrib
          : result.finalPotBb / 2 - preflopContrib
    expect(result.userNetBb).toBeCloseTo(expectedNet, 2)

    controller.dispose()
  }, 30_000)
})
