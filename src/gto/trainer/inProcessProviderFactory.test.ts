import { describe, it, expect } from 'vitest'
import { createInProcessProviderFactory } from './inProcessProviderFactory'
import { buildTurnSubgameTree, buildStreetTree } from '../tree/actionTree'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

// 小さめのレンジ・浅いスタックで木を小さく保ち、低イテレーションで高速に検証する。
const board4: Card[] = [card(13, 'c'), card(11, 'c'), card(2, 'd'), card(10, 's')]
const board5: Card[] = [...board4, card(4, 'h')]
const oopCombos: Combo[] = [
  [card(14, 'h'), card(14, 's')],
  [card(9, 'd'), card(9, 'h')],
]
const oopReach = [1, 1]
const ipCombos: Combo[] = [
  [card(8, 'h'), card(7, 'h')],
  [card(6, 'd'), card(5, 'd')],
]
const ipReach = [1, 1]

function maxAbsoluteDifference(actual: ArrayLike<number>, expected: ArrayLike<number>): number {
  let maxDifference = 0
  for (let i = 0; i < actual.length; i++) {
    maxDifference = Math.max(maxDifference, Math.abs(actual[i] - expected[i]))
  }
  return maxDifference
}

describe('createInProcessProviderFactory', () => {
  it('forLiveStreet(turn)のrootノードのactionLabelsがローカル構築の街木と一致する', async () => {
    const factory = createInProcessProviderFactory({ maxIterations: 20, targetExploitability: 0.05 })
    const provider = factory.forLiveStreet({
      street: 'turn',
      board: board4,
      oopCombos,
      oopReach,
      ipCombos,
      ipReach,
      potBb: 5.5,
      effectiveStackBb: 20,
    })
    await provider.ready

    const expectedTree = buildTurnSubgameTree({ turnPotBb: 5.5, effectiveStackBb: 20, firstToAct: 0, deadCards: board4 })
    if (expectedTree.kind !== 'decision') throw new Error('expected decision root')

    const nodes = await provider.getNodes([''])
    const root = nodes.get('')
    expect(root).not.toBeNull()
    expect(root!.actionLabels).toEqual(expectedTree.actionLabels)
    expect(root!.player).toBe(0)

    factory.dispose()
  })

  it('forLiveStreet(river)のrootノードのactionLabelsがローカル構築の街木と一致する', async () => {
    const factory = createInProcessProviderFactory({ maxIterations: 20, targetExploitability: 0.05 })
    const provider = factory.forLiveStreet({
      street: 'river',
      board: board5,
      oopCombos,
      oopReach,
      ipCombos,
      ipReach,
      potBb: 5.5,
      effectiveStackBb: 20,
    })
    await provider.ready

    const expectedTree = buildStreetTree({ potBb: 5.5, effectiveStackBb: 20, firstToAct: 0 })
    if (expectedTree.kind !== 'decision') throw new Error('expected decision root')

    const nodes = await provider.getNodes([''])
    const root = nodes.get('')
    expect(root).not.toBeNull()
    expect(root!.actionLabels).toEqual(expectedTree.actionLabels)

    factory.dispose()
  })

  it('terminalに到達するnodeId(木に存在しない)はnullを返す', async () => {
    const factory = createInProcessProviderFactory({ maxIterations: 20, targetExploitability: 0.05 })
    const provider = factory.forLiveStreet({
      street: 'turn',
      board: board4,
      oopCombos,
      oopReach,
      ipCombos,
      ipReach,
      potBb: 5.5,
      effectiveStackBb: 20,
    })
    await provider.ready

    const nodes = await provider.getNodes(['check-check-check-check-check-check-check-check-check-check'])
    expect(nodes.get('check-check-check-check-check-check-check-check-check-check')).toBeNull()

    factory.dispose()
  })

  it('取得したノードのfreqsは手ごとに行和が1になる', async () => {
    const factory = createInProcessProviderFactory({ maxIterations: 20, targetExploitability: 0.05 })
    const provider = factory.forLiveStreet({
      street: 'turn',
      board: board4,
      oopCombos,
      oopReach,
      ipCombos,
      ipReach,
      potBb: 5.5,
      effectiveStackBb: 20,
    })
    await provider.ready

    const nodes = await provider.getNodes([''])
    const root = nodes.get('')!
    const handCount = root.player === 0 ? oopCombos.length : ipCombos.length
    for (let h = 0; h < handCount; h++) {
      let sum = 0
      for (let a = 0; a < root.actionLabels.length; a++) sum += root.freqs[a * handCount + h]
      expect(sum).toBeCloseTo(1, 5)
    }

    factory.dispose()
  })

  it('P7-6a: maxIterations/targetExploitability/checkEveryIterationsはopts(テストシーム)がinput(呼び出し側の実値)より優先される', () => {
    // input側に「ほぼ止まらない」設定(反復上限が巨大・目標exploitabilityが0)を渡しても、
    // opts側の小さいmaxIterations(20)で確実に打ち切られることを、実測時間の短さで確認する。
    // 逆順(inputが勝つ)だとinput.maxIterations=100000まで回り、この閾値を大きく超える。
    const factory = createInProcessProviderFactory({ maxIterations: 20, targetExploitability: 0.05, checkEveryIterations: 5 })
    const start = performance.now()
    const provider = factory.forLiveStreet({
      street: 'turn',
      board: board4,
      oopCombos,
      oopReach,
      ipCombos,
      ipReach,
      potBb: 5.5,
      effectiveStackBb: 20,
      maxIterations: 100_000,
      targetExploitability: 0,
      checkEveryIterations: 1,
    })
    const elapsedMs = performance.now() - start
    expect(elapsedMs).toBeLessThan(3000)

    factory.dispose()
    void provider
  })

  it('progress()は常にnull(インプロセス実装は同期完了のため)', async () => {
    const factory = createInProcessProviderFactory({ maxIterations: 20, targetExploitability: 0.05 })
    const provider = factory.forLiveStreet({
      street: 'turn',
      board: board4,
      oopCombos,
      oopReach,
      ipCombos,
      ipReach,
      potBb: 5.5,
      effectiveStackBb: 20,
    })
    expect(provider.progress()).toBeNull()
    await provider.ready
    expect(provider.progress()).toBeNull()

    factory.dispose()
  })

  it('P9-3: 20反復の既存セッションを200反復まで継続し、一括200反復の戦略と一致する', async () => {
    const input = {
      street: 'river' as const,
      board: board5,
      oopCombos,
      oopReach,
      ipCombos,
      ipReach,
      potBb: 5.5,
      effectiveStackBb: 20,
    }
    const coarseFactory = createInProcessProviderFactory({ maxIterations: 20, targetExploitability: 0, checkEveryIterations: 20 })
    const coarse = coarseFactory.forLiveStreet(input)
    const before = (await coarse.getNodes([''])).get('')!
    const beforeFreqs = Array.from(before.freqs)

    coarse.refine({ targetExploitability: 0, maxIterations: 200, chunkIterations: 20 })
    expect(coarse.progress()).toBeNull() // 同期版は呼び出しから戻る時点で完了済み。
    const after = (await coarse.getNodes([''])).get('')!

    const referenceFactory = createInProcessProviderFactory({ maxIterations: 200, targetExploitability: 0, checkEveryIterations: 20 })
    const reference = referenceFactory.forLiveStreet(input)
    const expected = (await reference.getNodes([''])).get('')!

    // DCFRは反復番号に依存するため、20でリセットして180回やり直した戦略にはならない。
    // P9-1のチャンク分割等価性により、既存20+追加180は一括200の既知チェックポイントへ収束する。
    const beforeStrategyError = maxAbsoluteDifference(beforeFreqs, expected.freqs)
    const afterStrategyError = maxAbsoluteDifference(after.freqs, expected.freqs)
    expect(afterStrategyError).toBeLessThanOrEqual(1e-7) // Float32戦略頻度の明示許容誤差。
    expect(afterStrategyError).toBeLessThan(beforeStrategyError)
    expect(maxAbsoluteDifference(after.evsBb, expected.evsBb)).toBeLessThanOrEqual(1e-6) // EV(bb)の明示許容誤差。

    coarseFactory.dispose()
    referenceFactory.dispose()
  })
})
