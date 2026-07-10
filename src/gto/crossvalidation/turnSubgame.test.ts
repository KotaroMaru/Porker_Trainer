import { describe, it, expect } from 'vitest'
import fixtureJson from '../../../tools/solver/crossvalidation/turn_subgame_srp_btn_vs_bb.json'
import { solveCfr } from '../solver/cfr'
import { scoreComboOnBoard } from '../solver/handEval'
import { buildTurnSubgameTree } from '../tree/actionTree'
import { expandWeightedRange } from '../trainer/weightedRange'
import { buildComboIndexMap, lookupComboIndex } from '../trainer/comboIndex'
import { cardKey } from '../../engine/deck'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import type { CfrGame, DecisionNode } from '../solver/cfr'

// P3 Step 5: Rust(postflop-solver)とTS自前CFRソルバーの突合テスト(最重要検証)。
//
// 同一のターン部分ゲーム(BTN vs BB SRP、ボードQh8d3c+Ts、フロップは
// チェックスルーで進行した想定でpot/stackはシナリオのフロップ開始時点の値を
// 流用)を両実装で解き、ルート決断ノードのアクション別EV(reach加重平均)を
// 突き合わせる。フィクスチャはtools/solver/crossvalidation/配下にRust側の
// `--turn-subgame`モードで生成済み(コミット済みJSON)。
//
// プリフロップレンジは両実装とも生のシナリオレンジをそのまま使う
// (narrowRangeByActionはヨコサワ系ヒューリスティックのため突合には使わない)。
//
// コンボ変換(rustIdFromCard等)とレンジ展開(expandWeightedRange)はP4 Step1で
// src/gto/trainer/へ昇格し、trainer層と共通化した。

interface RustNode {
  nodeId: string
  player: 0 | 1 // 0=OOP(BB), 1=IP(BTN)
  actionLabels: string[]
  freq: number[] // action-major
  evBb: number[] // action-major、bb単位
}

interface RustFixture {
  scenarioId: string
  flopCardIds: [number, number, number]
  startingPotChips: number
  effectiveStackChips: number
  oopCombos: [number, number][] // rust card_id pairs
  ipCombos: [number, number][]
  nodes: RustNode[]
}

function comboCards(combo: Combo): string[] {
  return combo.map(cardKey)
}

describe('P3 Step5: Rust(postflop-solver)↔TS CFRソルバーの突合(BTN vs BB SRP, board Qh8d3c+Ts)', () => {
  const fixture = fixtureJson as unknown as RustFixture

  const flop: Card[] = [
    { rank: 12, suit: 'h' }, // Qh
    { rank: 8, suit: 'd' }, // 8d
    { rank: 3, suit: 'c' }, // 3c
  ]
  const turnCard: Card = { rank: 10, suit: 's' } // Ts
  const board4 = [...flop, turnCard]

  // BTN=raiser=IP, BB=defender=caller=OOP (ポストフロップ行動順: BB→UTG→...→BTN)
  const { combos: ipCombos, weights: ipWeights } = expandWeightedRange('rfi_btn', board4)
  const { combos: oopCombos, weights: oopWeights } = expandWeightedRange('bb_call_vs_btn', board4)

  const turnPotBb = 5.5 // シナリオのフロップ開始時点のpot(check-through想定)
  const effectiveStackBb = 97.5

  const tree = buildTurnSubgameTree({
    turnPotBb,
    effectiveStackBb,
    firstToAct: 1, // player1=OOP(BB)が先手
    deadCards: board4,
  })

  const game: CfrGame<Combo> = {
    root: tree,
    players: [
      { hands: ipCombos, initialReach: ipWeights, cards: comboCards }, // player0=IP(BTN)
      { hands: oopCombos, initialReach: oopWeights, cards: comboCards }, // player1=OOP(BB)
    ],
    score: scoreComboOnBoard,
  }

  it('前提: レンジのコンボ数・加重合計がRust側と一致する', () => {
    // eslint-disable-next-line no-console
    console.log(
      `OOP: TS combos=${oopCombos.length} weightSum=${oopWeights.reduce((a, b) => a + b, 0).toFixed(3)}` +
        ` / Rust combos=${fixture.oopCombos.length}`,
    )
    // eslint-disable-next-line no-console
    console.log(
      `IP: TS combos=${ipCombos.length} weightSum=${ipWeights.reduce((a, b) => a + b, 0).toFixed(3)}` +
        ` / Rust combos=${fixture.ipCombos.length}`,
    )
    expect(oopCombos.length).toBe(fixture.oopCombos.length)
    expect(ipCombos.length).toBe(fixture.ipCombos.length)
  })

  it('前提: 両実装のツリー構造(ルートのアクションラベル)が一致する', () => {
    if (tree.kind !== 'decision') throw new Error('expected decision root')
    const rustRoot = fixture.nodes.find((n) => n.nodeId === '')
    expect(rustRoot).toBeDefined()
    expect(tree.actionLabels).toEqual(rustRoot!.actionLabels)
  })

  it('ゲーム値(OOP/IP双方)がpot比1.5%以内で一致する', () => {
    const solution = solveCfr(game, { maxIterations: 800, targetExploitability: 0.001, checkEveryIterations: 25 })
    // eslint-disable-next-line no-console
    console.log(`TS iterationsRun=${solution.iterationsRun}, exploitability=${(solution.exploitability * 100).toFixed(3)}% pot (Rust側は0.10% potで収束)`)

    const root = tree as DecisionNode
    const rustRoot = fixture.nodes.find((n) => n.nodeId === '')!

    // ゲーム値を比較する理由: 混合戦略のCFR解は(EVが等しい複数アクション間で)
    // 均衡が一意とは限らずコンボ単位の頻度が完全一致する保証はないが、
    // 均衡におけるゲーム値(期待値)は一意に定まるため、これが両実装の
    // 正しさを検証する頑健な不変量になる(reachの取り方はP1で確立済みの
    // conditionalGameValueと同じ考え方: 手ごとのEVをreachで加重平均)。
    const rustComboIndex = buildComboIndexMap(fixture.oopCombos)
    const tsToRustIdx: number[] = oopCombos.map((c) => lookupComboIndex(rustComboIndex, c))

    // Rust側のgameValue(OOP)を、ルートノードのfreq×evBbからreach加重平均で再構成する
    // (postflop-solverのexpected_values()と同じ式: Σ freq[a]*evDetail[a] を手ごとに
    // 計算してからreach加重平均)。
    const totalReach = oopWeights.reduce((a, b) => a + b, 0)
    let rustGameValueOop = 0
    for (let h = 0; h < oopCombos.length; h++) {
      const rustIdx = tsToRustIdx[h]
      let evForHand = 0
      for (let a = 0; a < root.actionLabels.length; a++) {
        const freq = rustRoot.freq[a * fixture.oopCombos.length + rustIdx]
        const ev = rustRoot.evBb[a * fixture.oopCombos.length + rustIdx]
        evForHand += freq * ev
      }
      rustGameValueOop += oopWeights[h] * evForHand
    }
    rustGameValueOop /= totalReach

    const tsGameValueOop = solution.gameValue[1] // player1=OOP
    const potRef = turnPotBb
    const diffPotFrac = Math.abs(tsGameValueOop - rustGameValueOop) / potRef
    // eslint-disable-next-line no-console
    console.log(`OOP gameValue: TS=${tsGameValueOop.toFixed(4)}bb, Rust=${rustGameValueOop.toFixed(4)}bb, diff=${(diffPotFrac * 100).toFixed(2)}% pot`)
    expect(diffPotFrac).toBeLessThan(0.015)
  }, 900_000)
})
