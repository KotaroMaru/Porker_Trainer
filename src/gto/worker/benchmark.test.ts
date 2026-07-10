import { describe, it, expect } from 'vitest'
import { solveCfr } from '../solver/cfr'
import { scoreComboOnBoard } from '../solver/handEval'
import { buildTurnSubgameTree, collectDecisions } from '../tree/actionTree'
import { getRange } from '../data/ranges'
import { expandRange } from '../../analysis/range'
import { narrowRangeByAction } from '../../advisor/rangeModel'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'
import type { CfrGame } from '../solver/cfr'

// ============================================================
// P2性能ベンチマーク: 実際のプリフロップレンジ+実際のベッティングツリー規模で
// ターン部分ゲームを解き、所要時間を計測する。
// 目標(承認済みプラン): デスクトップ3〜6秒、iPhone10〜18秒、
// exploitability < 0.5% pot、メモリ典型30〜50MB/上限70MB。
//
// 注意: これはNode(V8)上での計測であり、iPhone Safari(JavaScriptCore)実機の
// 代わりにはならない。Node/Chromeは同じV8エンジンなのでデスクトップの目安には
// なるが、iPhoneでの最終的なGo/NoGo判断には実機での確認が必要(本ベンチマークは
// その判断のための一次情報を提供する位置づけ)。
// ============================================================

function comboCards(combo: Combo): string[] {
  return combo.map((c) => `${c.rank}${c.suit}`)
}

function buildRealisticSubgame(): { game: CfrGame<Combo>; decisionCount: number; heroCombos: number; villainCombos: number } {
  // BTN vs BB SRPを想定した現実的な状況: フロップでベット/コールが入り、
  // レンジが絞り込まれた後にターンを迎えたケース
  const flop: Card[] = [
    { rank: 12, suit: 'h' }, // Qh
    { rank: 8, suit: 'd' }, // 8d
    { rank: 3, suit: 'c' }, // 3c
  ]
  const turnCard: Card = { rank: 10, suit: 's' } // Ts
  const board4 = [...flop, turnCard]

  const raiserRange = getRange('rfi_btn')
  const callerRange = getRange('bb_call_vs_btn')
  const raiserHands = new Set(Object.keys(raiserRange).filter((h) => raiserRange[h] > 0))
  const callerHands = new Set(Object.keys(callerRange).filter((h) => callerRange[h] > 0))

  const raiserCombosPreflop = expandRange(raiserHands, flop)
  const callerCombosPreflop = expandRange(callerHands, flop)

  // フロップでOOP(BB)がチェック、IP(BTN)がベット、BBがコール、という想定でレンジを絞る
  const raiserCombosPostflop = narrowRangeByAction(raiserCombosPreflop, flop, 'bet')
  const callerCombosPostflop = narrowRangeByAction(callerCombosPreflop, flop, 'call')

  // ターンカードと重複するコンボを除外
  const turnKey = `${turnCard.rank}${turnCard.suit}`
  function excludeTurnCard(combos: Combo[]): Combo[] {
    return combos.filter((c) => !c.some((card) => `${card.rank}${card.suit}` === turnKey))
  }
  const heroCombos = excludeTurnCard(raiserCombosPostflop)
  const villainCombos = excludeTurnCard(callerCombosPostflop)

  const tree = buildTurnSubgameTree({
    turnPotBb: 9.1,
    effectiveStackBb: 95.7,
    firstToAct: 1, // BB(コーラー)がOOPで先手
    deadCards: board4,
  })
  const decisionCount = collectDecisions(tree).length

  const game: CfrGame<Combo> = {
    root: tree,
    players: [
      { hands: heroCombos, initialReach: heroCombos.map(() => 1), cards: comboCards },
      { hands: villainCombos, initialReach: villainCombos.map(() => 1), cards: comboCards },
    ],
    score: scoreComboOnBoard,
  }

  return { game, decisionCount, heroCombos: heroCombos.length, villainCombos: villainCombos.length }
}

describe('P2性能ベンチマーク: 実際のレンジ規模でのターン部分ゲーム解', () => {
  it(
    '本番想定パラメータ(上限500反復・目標expl 0.5% pot)で収束時間を計測する',
    () => {
      const { game, decisionCount, heroCombos, villainCombos } = buildRealisticSubgame()

      console.log(`--- ベンチマーク設定 ---`)
      console.log(`決断ノード数: ${decisionCount}`)
      console.log(`heroコンボ数: ${heroCombos}, villainコンボ数: ${villainCombos}`)

      const t0 = performance.now()
      const solution = solveCfr(game, {
        maxIterations: 500,
        targetExploitability: 0.005,
        checkEveryIterations: 25,
        onProgress: (iter, expl) => {
          console.log(`  iter=${iter} t=${(performance.now() - t0).toFixed(0)}ms expl=${(expl * 100).toFixed(3)}%`)
        },
      })
      const elapsedMs = performance.now() - t0

      console.log(`--- 結果 ---`)
      console.log(`所要時間: ${elapsedMs.toFixed(0)}ms`)
      console.log(`反復回数: ${solution.iterationsRun}`)
      console.log(`exploitability: ${(solution.exploitability * 100).toFixed(3)}% pot`)
      console.log(`ゲーム値(hero,villain): ${solution.gameValue[0].toFixed(3)}, ${solution.gameValue[1].toFixed(3)}bb`)

      expect(solution.exploitability).toBeLessThan(0.01) // 1% pot以内(目標0.5%に対する緩めのリグレッションガード)
    },
    300_000, // フルスイート実行時は他の重いCFRテスト(crossvalidation等)と並列実行され
    // CPU競合で単体実行より遅くなるため、120sでは不足することがある。余裕を持たせる。
  )
})
