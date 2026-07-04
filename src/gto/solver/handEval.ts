import type { Card } from '../../engine/types'
import { evaluate, compareHands } from '../../engine/evaluator'
import { cardKey } from '../../engine/deck'
import type { Combo } from '../../analysis/range'

function comboKey(combo: Combo): string {
  return combo.map(cardKey).sort().join(',')
}

function comboCards(combo: Combo): Set<string> {
  return new Set(combo.map(cardKey))
}

/** cardKey形式("13c")の文字列をCardに戻す(rank+suit、rankは複数桁ありうるため末尾1文字をsuitとする)。 */
function parseCardKey(key: string): Card {
  const suit = key[key.length - 1] as Card['suit']
  const rank = Number(key.slice(0, -1)) as Card['rank']
  return { rank, suit }
}

/**
 * コンボの絶対的な強さスコアを返す。CfrGame<Combo>.scoreにそのまま渡せる
 * (第2引数はTerminalNode.board=cardKey形式の文字列配列。チャンスノードを
 * 経由する木では分岐ごとに異なるボードで評価する必要があるため必須)。
 */
export function scoreComboOnBoard(combo: Combo, boardKeys?: string[]): number {
  const board = (boardKeys ?? []).map(parseCardKey)
  return evaluate([...combo, ...board]).score
}

/**
 * 指定ボード固定でのコンボ比較関数を作る(チャンスノードを持たない、単一ボードの
 * 部分ゲーム専用。ボードが分岐ごとに変わる場合はscoreComboOnBoardを直接使うこと)。
 */
export function compareCombosOnBoard(board: Card[]): (a: Combo, b: Combo) => number {
  return (a, b) => compareHands([...a, ...board], [...b, ...board])
}

export interface RankedCombo {
  combo: Combo
  score: number
}

/** 指定ボードでの各コンボの強さ(evaluateのスコア)を計算し、強い順にソートして返す。 */
export function rankCombosOnBoard(combos: Combo[], board: Card[]): RankedCombo[] {
  const ranked = combos.map((combo) => ({ combo, score: evaluate([...combo, ...board]).score }))
  ranked.sort((a, b) => b.score - a.score)
  return ranked
}

/** score以上が現れる最初のインデックス(scoresは昇順ソート済み前提)。 */
function lowerBound(scores: number[], score: number): number {
  let lo = 0
  let hi = scores.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (scores[mid] < score) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** scoreより大きい値が現れる最初のインデックス(scoresは昇順ソート済み前提)。 */
function upperBound(scores: number[], score: number): number {
  let lo = 0
  let hi = scores.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (scores[mid] <= score) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface RangeEquityResult {
  /** コンボキー("14s,2d"のような正規化済み文字列) -> エクイティ(0..1) */
  perComboEquity: Map<string, number>
  /** heroレンジ全体のコンボ単純平均エクイティ(頻度加重ではない、combo単位の平均) */
  averageEquity: number
}

/**
 * heroの各コンボについて、villainレンジに対するエクイティ(勝ち+引分/2)を計算する。
 * villain側のスコアを1回だけ昇順ソートし、hero側の各コンボはevaluateを1回呼んで
 * 二分探索(lowerBound/upperBound)で「villain全体に対する勝ち・引分・負け件数」を
 * O(log M)で求める(ソート済みスイープ)。これによりevaluateの呼び出し回数は
 * O(N+M)に抑えられる(N*M回の対戦シミュレーションが不要)。ボードとの重複・
 * hero/villain間のカード重複(ブロッキング)による除外分は、villain全件をO(M)で
 * 走査して差し引く(evaluateは呼ばない軽い比較のみ)。カードごとのコンボ索引を
 * 事前構築してこの補正もO(1)に近づける最適化はP7で行う。
 */
export function computeRangeVsRangeEquity(heroCombos: Combo[], villainCombos: Combo[], board: Card[]): RangeEquityResult {
  const villainRanked = villainCombos
    .map((combo) => ({ combo, score: evaluate([...combo, ...board]).score }))
    .sort((a, b) => a.score - b.score)
  const scores = villainRanked.map((v) => v.score)

  const perComboEquity = new Map<string, number>()
  let sum = 0
  let count = 0

  for (const heroCombo of heroCombos) {
    const heroScore = evaluate([...heroCombo, ...board]).score
    const heroCardSet = comboCards(heroCombo)

    const belowCount = lowerBound(scores, heroScore) // heroScore未満(hero勝ち)の件数
    const uptoCount = upperBound(scores, heroScore) // heroScore以下の件数
    let win = belowCount
    let tie = uptoCount - belowCount
    let total = villainRanked.length

    // ブロッキング補正: heroの手とカードが重複するvillainコンボだけを個別に除外する
    for (const v of villainRanked) {
      let blocked = false
      for (const c of v.combo) {
        if (heroCardSet.has(cardKey(c))) { blocked = true; break }
      }
      if (!blocked) continue
      total--
      if (v.score < heroScore) win--
      else if (v.score === heroScore) tie--
    }

    const equity = total > 0 ? (win + tie * 0.5) / total : 0
    perComboEquity.set(comboKey(heroCombo), equity)
    sum += equity
    count++
  }

  return { perComboEquity, averageEquity: count > 0 ? sum / count : 0 }
}
