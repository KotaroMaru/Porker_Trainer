/// <reference types="node" />
// P6 Step B5: FullHandController(通しモードのマルチストリート状態機械)の統合テスト。
// 実.binフィクスチャ(srp_btn_vs_bb/AsQsJs)+createInProcessProviderFactory(B4のテスト
// シーム、Web Workerを使わず同一パイプラインを同期・低イテレーションで実行)を使う。
// フィクスチャ読み込みはjoin(process.cwd(),...)方式(precomputedProvider.test.tsと同じ、
// import.meta.url経由は既知の環境依存問題があるため不採用)。

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FullHandController, type FullHandSnapshot } from './fullHandFlow'
import { createInProcessProviderFactory } from './inProcessProviderFactory'
import type { GetNodesOptions, NodeProviderFactory, StreetSolveInput } from './nodeDataProvider'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'
import { getScenario, preflopContribPerPlayerBb } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import { cardKey } from '../../engine/deck'
import { evaluate } from '../../engine/evaluator'
import * as turnBundleSource from '../loader/turnBundleSource'

const FLOP_STR = 'AsQsJs'

function fixedRng(sequence: number[]): () => number {
  let i = 0
  return () => sequence[Math.min(i++, sequence.length - 1)]
}

/**
 * onUpdateの通知を蓄積し、userTurn/over(=ユーザー入力を待つ一時停止点)まで待てるようにする。
 *
 * 「最新スナップショット」ではなく「未消費の一時停止スナップショット」を保持して返す。
 * chooseActionの直後にはbotDeciding(一時停止ではない)が挟まるため、latestを返すと
 * 停止点ではないスナップショットを掴んでしまう。同じ停止を二度返さないよう、
 * 返したらnullへ戻す。
 */
function createWaiter() {
  let latest: FullHandSnapshot | null = null
  let pendingPause: FullHandSnapshot | null = null
  let waitingResolve: (() => void) | null = null
  const updates: FullHandSnapshot[] = []
  const onUpdate = (snap: FullHandSnapshot) => {
    latest = snap
    updates.push(snap)
    if (snap.phase === 'userTurn' || snap.phase === 'over') {
      pendingPause = snap
      if (waitingResolve) {
        const r = waitingResolve
        waitingResolve = null
        r()
      }
    }
  }
  async function waitForPause(): Promise<FullHandSnapshot> {
    if (!pendingPause) {
      await new Promise<void>((resolve) => {
        waitingResolve = resolve
      })
    }
    const paused = pendingPause!
    pendingPause = null
    return paused
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

  // このファイルの全テストで実ネットワークを禁止する。個別テストだけ応答を上書きする。
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
  })

  function makeFactory(): NodeProviderFactory {
    const inner = createInProcessProviderFactory({ maxIterations: 15, targetExploitability: 0.1 })
    return {
      forFlop: (solution, board) => inner.forFlop(solution, board),
      forLiveStreet: (input) => {
        const real = inner.forLiveStreet(input)
        return {
          ...real,
          // 本番の300反復を同期実行すると統合テストの各ハンドが数十秒停止するため、
          // テストシームでは同一セッションを追加5反復だけ確実に進める。
          refine: () => real.refine({ maxIterations: 20, targetExploitability: 0, chunkIterations: 5 }),
        }
      },
      dispose: () => inner.dispose(),
    }
  }

  it('収録済みcheck-checkではハイフン区切りpathIdのバンドルを使い、ライブソルブもrefineも開始しない', async () => {
    const loadSpy = vi.spyOn(turnBundleSource, 'loadTurnBundleSolution').mockImplementation(async request => {
      const turnKey = cardKey(request.turnCard)
      return {
        ...flopSolution,
        oopCombos: flopSolution.oopCombos.filter(combo => combo.every(card => cardKey(card) !== turnKey)),
        ipCombos: flopSolution.ipCombos.filter(combo => combo.every(card => cardKey(card) !== turnKey)),
      }
    })
    const inner = makeFactory()
    let precomputedTurnProvider: ReturnType<NodeProviderFactory['forFlop']> | null = null
    let liveCalls = 0
    let refineCalls = 0
    const factory: NodeProviderFactory = {
      forFlop: (solution, board) => {
        const real = inner.forFlop(solution, board)
        precomputedTurnProvider = {
          ...real,
          refine: () => { refineCalls++ },
        }
        return precomputedTurnProvider
      },
      forLiveStreet: (input) => {
        liveCalls++
        return inner.forLiveStreet(input)
      },
      dispose: () => inner.dispose(),
    }
    const waiter = createWaiter()
    const errors: Error[] = []
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 0,
      rng: fixedRng([1e-9]),
      providerFactory: factory,
      onUpdate: waiter.onUpdate,
      onError: error => errors.push(error),
    })
    controller.start()

    const flopSnap = await waiter.waitForPause()
    expect(flopSnap.street).toBe('flop')
    controller.chooseAction('check')
    const turnSnap = await waiter.waitForPause()

    expect(turnSnap.street).toBe('turn')
    expect(turnSnap.turnSolutionSource).toBe('precomputed')
    expect(loadSpy).toHaveBeenCalledWith(expect.objectContaining({
      scenarioId: 'srp_btn_vs_bb',
      flopId: 'AsQsJs',
      pathId: 'check-check',
    }))
    expect(loadSpy.mock.calls[0][0].pathId).not.toContain('/')
    expect(precomputedTurnProvider).not.toBeNull()
    expect(precomputedTurnProvider!.progress()).toBeNull()
    expect(liveCalls).toBe(0)
    expect(refineCalls).toBe(0)
    expect(errors).toEqual([])
    controller.dispose()
  }, 30_000)

  it.each([
    ['ネットワークエラー', () => Promise.reject(new TypeError('offline'))],
    ['404', () => Promise.resolve(new Response(null, { status: 404 }))],
    ['不正バイト列', () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))],
  ])('%sでは例外を漏らさず従来のターンライブソルブへ退避する', async (_name, responseFactory) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(responseFactory))
    let precomputedCalls = 0
    let liveCalls = 0
    let refineCalls = 0
    const factory: NodeProviderFactory = {
      forFlop: () => {
        precomputedCalls++
        throw new Error('unexpected precomputed provider')
      },
      forLiveStreet: (input) => {
        liveCalls++
        return {
          street: input.street,
          board: input.board,
          oopCombos: input.oopCombos,
          ipCombos: input.ipCombos,
          ready: Promise.resolve(),
          async getNodes(nodeIds) {
            return new Map(nodeIds.map(nodeId => [nodeId, null]))
          },
          progress: () => null,
          refine: () => { refineCalls++ },
          dispose: () => {},
        }
      },
      dispose: () => {},
    }
    const waiter = createWaiter()
    const errors: Error[] = []
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 0,
      rng: fixedRng([1e-9]),
      providerFactory: factory,
      onUpdate: waiter.onUpdate,
      onError: error => errors.push(error),
    })
    controller.start()

    await waiter.waitForPause()
    controller.chooseAction('check')
    const turnSnap = await waiter.waitForPause()

    expect(turnSnap.street).toBe('turn')
    expect(turnSnap.turnSolutionSource).toBe('live')
    expect(precomputedCalls).toBe(0)
    expect(liveCalls).toBe(1)
    expect(refineCalls).toBe(1)
    expect(errors).toEqual([])
    controller.dispose()
  }, 30_000)

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
    expect(final.refining).toBe(false)

    // P7-6b: ターンのライブソルブが一度も発生していない(=リファイン素材が無い)ため、
    // ハンド終了後もリファインは走らない(forLiveStreetの追加呼び出しが発生しない)。
    await new Promise((resolve) => setTimeout(resolve, 20))
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

  it('P7-2: latestActionsは直近の履歴エントリと一致し、同じ街の間はユーザー分も蓄積される', async () => {
    // userSeat=1(IP): ボットが先手(OOP)。低反復ソルブ(maxIterations:15)の平均戦略は
    // 各手の頻度が厳密に1.0へ正規化されない場合があり、rngを特定の値に固定しても
    // sampleActionが選ぶラベルを事前に断定できない。そのため「ボットが何を選んだか」を
    // 仮定せず、historyの直近エントリとlatestActionsが一致することを検証する
    // (P7-2の目的である「追跡の仕組みが正しいこと」の検証には、具体的な選択内容は不要)。
    const rng = fixedRng([0.4])
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

    const facingBot = await waiter.waitForPause()
    expect(facingBot.phase).toBe('userTurn')
    const botEntriesThisStreet = facingBot.history.filter((h) => !h.isUserDecision && h.street === facingBot.street)
    expect(botEntriesThisStreet.length).toBeGreaterThan(0)
    const lastBotEntry = botEntriesThisStreet[botEntriesThisStreet.length - 1]
    const botLatest = facingBot.latestActions.find((a) => !a.isUser)
    expect(botLatest?.label).toBe(lastBotEntry.label)
    expect(botLatest?.position).toBe(lastBotEntry.position)

    const chosenLabel = facingBot.actionsWithAmounts[0].label
    controller.chooseAction(chosenLabel)
    const afterUser = await waiter.waitForPause()

    if (afterUser.street === facingBot.street) {
      // 同じ街のまま継続(コール等)、またはfold/オールインでoverに到達: ユーザー分も記録されている。
      expect(afterUser.latestActions.find((a) => a.isUser)?.label).toBe(chosenLabel)
    } else {
      // 街が変わった場合: userSeat=1(ボットがOOPで常に先手)なので、ユーザーの手番が
      // 回ってくる時点で既にボットが新しい街で1手行動済み(reset自体はP7-2の別テスト
      // 「街が遷移するとlatestActionsが空にリセットされる」でuserSeat=0を使い直接検証
      // 済み)。ここでは新しい街のlatestActionsがそのhistoryの直近エントリと整合する
      // ことを確認する(前の街のエントリが残留していないことの間接的な証拠にもなる)。
      const botEntriesNewStreet = afterUser.history.filter((h) => !h.isUserDecision && h.street === afterUser.street)
      expect(botEntriesNewStreet.length).toBeGreaterThan(0)
      const lastBotEntryNewStreet = botEntriesNewStreet[botEntriesNewStreet.length - 1]
      expect(afterUser.latestActions.find((a) => !a.isUser)?.label).toBe(lastBotEntryNewStreet.label)
    }

    controller.dispose()
  }, 30_000)

  it('P9-4: ターンprovider作成直後に同一セッションを精密化し、終了時は待ちゼロで決断を差し替える', async () => {
    // check-checkのみで進行するパッシブなライン。ターンproviderのrefine()がターン開始前に
    // 呼ばれ、新規providerを作らずに同一セッションを再収穫することを確認する。
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    let forLiveStreetCalls = 0
    let refineCalls = 0
    const baseFactory = makeFactory()
    const spyFactory: NodeProviderFactory = {
      forFlop: (s, b) => baseFactory.forFlop(s, b),
      forLiveStreet: (input: StreetSolveInput) => {
        forLiveStreetCalls++
        const real = baseFactory.forLiveStreet(input)
        if (input.street !== 'turn') return real
        return {
          ...real,
          refine: (opts) => {
            refineCalls++
            expect(opts).toEqual({
              maxIterations: 300,
              targetExploitability: 0.005,
              chunkIterations: 8,
              measureEveryIterations: 48,
            })
            real.refine(opts)
          },
        }
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

    let snap = await waiter.waitForPause()
    expect(snap.street).toBe('flop')
    controller.chooseAction('check')
    snap = await waiter.waitForPause()
    expect(snap.street).toBe('turn')
    expect(refineCalls).toBe(1) // ターンのユーザー手番が表示される前に早期開始済み

    while (snap.phase !== 'over') {
      controller.chooseAction('check')
      snap = await waiter.waitForPause()
    }
    const turnBeforeRefineHarvest = controller.getReview().decisions[1]
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(snap.refining).toBe(false)
    expect(waiter.updates.some((u) => u.refining)).toBe(false) // progress()===nullの待ちゼロパス
    expect(forLiveStreetCalls).toBe(2) // ターン+リバーのみ。リファイン用providerは新規作成しない
    expect(refineCalls).toBe(1)

    const review = controller.getReview()
    expect(review.decisions.length).toBe(3)
    const turnDecision = review.decisions[1]
    expect(turnDecision).not.toBe(turnBeforeRefineHarvest) // 精密セッションから再収穫して差し替え
    expect(turnDecision.street).toBe('turn')
    expect(['correct', 'marginal', 'incorrect']).toContain(turnDecision.grading.verdict)
    const heroSum = turnDecision.heroWeights.reduce((a, b) => a + b, 0)
    expect(heroSum).toBeCloseTo(1, 5)

    controller.dispose()
  }, 30_000)

  it('P9-4: 未収束のターンrefineProgressを反映し、完了後に精密な決断へ差し替える', async () => {
    // ターンproviderのrefine()は実際に同期実行し、外部公開progress()だけをゲートすることで、
    // 「リファイン中はrefineProgressが実際のソルブ進捗を反映し、完了後はnullに戻る」ことを
    // 確定的に検証する(store.test.tsのP7-6bゲート付きファクトリと同じ手法)。
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    let callIdx = 0
    let refineWasCalled = false
    let releaseRefine: (() => void) | null = null
    let refineProgressValue = 0
    const gate = new Promise<void>((resolve) => {
      releaseRefine = resolve
    })
    const baseFactory = makeFactory()
    const spyFactory: NodeProviderFactory = {
      forFlop: (s, b) => baseFactory.forFlop(s, b),
      forLiveStreet: (input: StreetSolveInput) => {
        callIdx++
        const real = baseFactory.forLiveStreet(input) // in-processは呼び出し時点で既に同期的に解いている
        if (callIdx !== 1) return real
        let refining = false
        return {
          ...real,
          refine: (opts) => {
            refineWasCalled = true
            refining = true
            real.refine(opts)
            void gate.then(() => {
              refining = false
            })
          },
          progress: () => (refining ? { fraction: refineProgressValue } : real.progress()),
        }
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

    let snap = await waiter.waitForPause()
    while (snap.phase !== 'over') {
      controller.chooseAction('check')
      snap = await waiter.waitForPause()
    }
    const turnBeforeRefineHarvest = controller.getReview().decisions[1]
    expect(callIdx).toBe(2)
    expect(refineWasCalled).toBe(true)
    expect(snap.refining).toBe(true)
    expect(snap.refineProgress).toBe(0)

    // progress()の返り値を更新し、~500msごとのポーリングが拾うのを待つ(700ms=1周期以上)。
    refineProgressValue = 0.42
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(waiter.latest?.refining).toBe(true)
    expect(waiter.latest?.refineProgress).toBeCloseTo(0.42, 5)

    releaseRefine!()
    let final = waiter.latest!
    while (final.refining) {
      final = await waiter.waitForPause()
    }
    expect(final.refining).toBe(false)
    expect(final.refineProgress).toBeNull()
    const turnDecision = controller.getReview().decisions[1]
    expect(turnDecision).not.toBe(turnBeforeRefineHarvest)
    expect(turnDecision.heroWeights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 5)
    expect(['correct', 'marginal', 'incorrect']).toContain(turnDecision.grading.verdict)

    controller.dispose()
  }, 30_000)

  it('P9-4: リファイン中のdispose()は同一ターンproviderを一度だけ解放する', async () => {
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    const gate = new Promise<void>(() => {})
    let callIdx = 0
    let turnDisposeCalls = 0
    const baseFactory = makeFactory()
    const spyFactory: NodeProviderFactory = {
      forFlop: (s, b) => baseFactory.forFlop(s, b),
      forLiveStreet: (input) => {
        callIdx++
        const real = baseFactory.forLiveStreet(input)
        if (callIdx !== 1) return real
        let refining = false
        return {
          ...real,
          refine: (opts) => {
            refining = true
            real.refine(opts)
            void gate.then(() => {
              refining = false
            })
          },
          progress: () => (refining ? { fraction: 0.5 } : real.progress()),
          dispose: () => {
            turnDisposeCalls++
            real.dispose()
          },
        }
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

    let snap = await waiter.waitForPause()
    while (snap.phase !== 'over') {
      controller.chooseAction('check')
      snap = await waiter.waitForPause()
    }

    expect(snap.refining).toBe(true)
    expect(() => controller.dispose()).not.toThrow()
    // 破棄後に残っていたリファインの継続処理が非同期で走ってもクラッシュしないことを、
    // 数ティック分の猶予を与えて確認する(onErrorが呼ばれれば`throw`でテストが失敗する)。
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(turnDisposeCalls).toBe(1)
  }, 30_000)

  it('P9-4: ターンでfoldして直接終了しても保持済みproviderから精密決断を収穫する', async () => {
    let rngValue = 1e-9
    const waiter = createWaiter()
    let forLiveStreetCalls = 0
    let refineCalls = 0
    const baseFactory = makeFactory()
    const spyFactory: NodeProviderFactory = {
      forFlop: (s, b) => baseFactory.forFlop(s, b),
      forLiveStreet: (input) => {
        forLiveStreetCalls++
        const real = baseFactory.forLiveStreet(input)
        if (input.street !== 'turn') return real
        return {
          ...real,
          refine: (opts) => {
            refineCalls++
            real.refine(opts)
          },
        }
      },
      dispose: () => baseFactory.dispose(),
    }
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 0,
      rng: () => rngValue,
      providerFactory: spyFactory,
      onUpdate: waiter.onUpdate,
      onError: (err) => { throw err },
    })
    controller.start()

    let snap = await waiter.waitForPause()
    expect(snap.street).toBe('flop')
    controller.chooseAction('check')
    snap = await waiter.waitForPause()
    expect(snap.street).toBe('turn')
    expect(refineCalls).toBe(1)

    // ターンでユーザーcheck後、rngを末尾側へ振ってボットの最大ベットを選ばせ、foldする。
    rngValue = 0.999999
    controller.chooseAction('check')
    snap = await waiter.waitForPause()
    expect(snap.street).toBe('turn')
    expect(snap.actionsWithAmounts.some((action) => action.label === 'fold')).toBe(true)
    controller.chooseAction('fold')
    snap = await waiter.waitForPause()
    expect(snap.phase).toBe('over')
    expect(snap.result?.endedBy).toBe('fold')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(forLiveStreetCalls).toBe(1) // riverへ遷移せず、リファイン用providerも新規作成しない
    const turnDecisions = controller.getReview().decisions.filter((decision) => decision.street === 'turn')
    expect(turnDecisions.length).toBe(2)
    for (const decision of turnDecisions) {
      expect(decision.heroWeights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 5)
      expect(['correct', 'marginal', 'incorrect']).toContain(decision.grading.verdict)
    }

    controller.dispose()
  }, 30_000)

  it('P7-2: 街が遷移するとlatestActionsが空にリセットされる', async () => {
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

    const flopTurn = await waiter.waitForPause()
    expect(flopTurn.street).toBe('flop')
    controller.chooseAction('check')
    const turnTurn = await waiter.waitForPause()

    expect(turnTurn.street).toBe('turn')
    // ターン開始直後(まだ誰も行動していない)なのでフロップの最後のアクションを引きずらない。
    expect(turnTurn.latestActions).toEqual([])

    controller.dispose()
  }, 30_000)

  it('P13 Phase E-1回帰: ボット決断待ち中もsolveProgressが複数回・単調に更新される(以前は0%のまま固まっていた)', async () => {
    // userSeat=1(ヒーローIP)にすることで、ターンのfirstToAct=0(ボット側)を
    // ボット決断として捕まえる(P9-4のrefineProgressテストと同じ「providerをゲートで
    // 止めてprogress()だけ差し替える」手法をready自体に適用する)。
    const rng = fixedRng([1e-9])
    const waiter = createWaiter()
    let callIdx = 0
    let releaseReady: (() => void) | null = null
    let solveProgressValue = 0
    const turnGetNodesOptions: (GetNodesOptions | undefined)[] = []
    const gate = new Promise<void>((resolve) => {
      releaseReady = resolve
    })
    const baseFactory = makeFactory()
    const spyFactory: NodeProviderFactory = {
      forFlop: (s, b) => baseFactory.forFlop(s, b),
      forLiveStreet: (input: StreetSolveInput) => {
        callIdx++
        const real = baseFactory.forLiveStreet(input) // in-processは呼び出し時点で既に同期的に解いている
        if (callIdx !== 1) return real // 1回目=ターンのみ計装
        let stillSolving = true
        const gatedReady = gate.then(() => {
          stillSolving = false
        })
        return {
          ...real,
          ready: gatedReady,
          progress: () => (stillSolving ? { fraction: solveProgressValue } : real.progress()),
          getNodes: (nodeIds, options) => {
            turnGetNodesOptions.push(options)
            return real.getNodes(nodeIds, options)
          },
        }
      },
      dispose: () => baseFactory.dispose(),
    }
    const controller = new FullHandController({
      scenario,
      flop,
      flopSolution,
      userSeat: 1,
      rng,
      providerFactory: spyFactory,
      onUpdate: waiter.onUpdate,
      onError: (err) => { throw err },
    })
    controller.start()

    let snap = await waiter.waitForPause()
    expect(snap.street).toBe('flop')
    controller.chooseAction('check')
    // ターンはボット(OOP)が先手のためユーザーの手番は来ない。botDecidingで止まったまま
    // gateが解放されるまで待つ(waitForPauseはuserTurn/overでしか解決しないため使わない)。
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(waiter.latest?.phase).toBe('botDeciding')
    expect(waiter.latest?.street).toBe('turn')
    expect(waiter.latest?.solveProgress).toBeCloseTo(0, 5)
    expect(waiter.latest?.solvePhase).toBe('solving')

    const updatesBefore = waiter.updates.length
    solveProgressValue = 0.3
    await new Promise((resolve) => setTimeout(resolve, 250))
    solveProgressValue = 0.7
    await new Promise((resolve) => setTimeout(resolve, 250))

    // ポーリング(200ms間隔)により、phase遷移を挟まずとも複数回emitされ、
    // solveProgressが単調に更新されている。
    const botDecidingUpdates = waiter.updates.slice(updatesBefore).filter((u) => u.phase === 'botDeciding' && u.street === 'turn')
    expect(botDecidingUpdates.length).toBeGreaterThan(1)
    const progressValues = botDecidingUpdates.map((u) => u.solveProgress)
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]!).toBeGreaterThanOrEqual(progressValues[i - 1]!)
    }
    expect(progressValues[progressValues.length - 1]).toBeCloseTo(0.7, 5)

    solveProgressValue = 1
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(waiter.latest?.solveProgress).toBe(1)
    expect(waiter.latest?.solvePhase).toBe('finalizing')

    releaseReady!()
    snap = await waiter.waitForPause()
    while (snap.phase !== 'over') {
      controller.chooseAction('check')
      snap = await waiter.waitForPause()
    }

    expect(turnGetNodesOptions.some((options) => options?.withEvs === false)).toBe(true)
    expect(turnGetNodesOptions.some((options) => options?.withEvs === true)).toBe(true)

    controller.dispose()
  }, 30_000)
})
