import type { Card, Position } from '../engine/types'
import { createDeck, shuffle, cardLabel } from '../engine/deck'
import { handString, OPEN_RANGES, THREEBET_RANGES } from './ranges'
import { getYokosawaTier, getYokosawaAdvice } from './yokosawa'
import type { YokosawaTier, YokosawaAction } from './yokosawa'
import { actionOrder } from '../engine/positions'
import { narrowRangeByAction, combosToHandSet, FULL_RANGE } from './rangeModel'
import { expandRange } from '../analysis/range'

// ============================================================
// 一問一答(クイズ)用: 出題と採点の純粋関数
// ============================================================

export interface RandomHand {
  cards: [Card, Card]
  handStr: string      // 'AKs' 等の表記
  rank1: number        // 高い方のランク(数値)
  rank2: number        // 低い方のランク(数値)
  suited: boolean
}

// 相異なる 2 枚を引いてハンド表記に変換
export function randomHand(): RandomHand {
  const deck = shuffle(createDeck())
  const c1 = deck[0]
  const c2 = deck[1]
  const suited = c1.suit === c2.suit
  // 高い方を rank1 に
  const [hi, lo] = c1.rank >= c2.rank ? [c1, c2] : [c2, c1]
  return {
    cards: [hi, lo],
    handStr: handString(hi.rank, lo.rank, suited),
    rank1: hi.rank,
    rank2: lo.rank,
    suited,
  }
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------- モード①: ヨコサワフォールド/レイズ判定 ----------------
export type PreflopAnswer = 'raise' | 'fold'

export interface PreflopQuestion {
  position: Position
  hand: RandomHand
  correct: PreflopAnswer
  tableSize: number
  reasoning: string
}

export function makePreflopQuestion(): PreflopQuestion {
  // 6〜8人テーブルをランダム選択(セブのキャッシュゲーム想定)
  const tableSize = 6 + Math.floor(Math.random() * 3)
  // RFIポジション = BB を除いた行動順
  const order = actionOrder(tableSize)
  const rfiPositions = order.filter(p => p !== 'BB')
  const position = pick(rfiPositions)
  const hand = randomHand()
  const advice = getYokosawaAdvice({
    position,
    handStr: hand.handStr,
    facingRaise: false,
    tableSize,
  })
  // open → レイズ、それ以外(fold) → フォールド扱い
  const correct: PreflopAnswer = advice.action === 'open' ? 'raise' : 'fold'
  return { position, hand, correct, tableSize, reasoning: advice.reasoning }
}

// ---------------- モード②: ヨコサワ色当て ----------------
export interface TierQuestion {
  hand: RandomHand
  correct: YokosawaTier
}

export function makeTierQuestion(): TierQuestion {
  const hand = randomHand()
  return { hand, correct: getYokosawaTier(hand.handStr) }
}

// ---------------- モード③: リレイズ判定(実践形式) ----------------
export interface ReraiseQuestion {
  position: Position       // 自分のポジション
  raiserPosition: Position // レイザー(自分より前)
  raiseCount: number       // 1 = シングルレイズ, 2 = 3bet
  hand: RandomHand
  correct: YokosawaAction
  reasoning: string
  tableSize: number
}

export function makeReraiseQuestion(): ReraiseQuestion {
  const tableSize = 6 + Math.floor(Math.random() * 3)
  const order = actionOrder(tableSize)
  // 自分のポジション(レイザーが前に1人以上いる必要があるので最初以外)
  const myIdx = 1 + Math.floor(Math.random() * (order.length - 1))
  const position = order[myIdx]
  // レイザーは自分より前(行動順が早い)から抽選
  const raiserPosition = pick(order.slice(0, myIdx))
  // 80% シングルレイズ、20% 3bet
  const raiseCount = Math.random() < 0.2 ? 2 : 1
  const hand = randomHand()
  const advice = getYokosawaAdvice({
    position,
    handStr: hand.handStr,
    facingRaise: true,
    raiserPosition,
    raiseCount,
    tableSize,
  })
  return {
    position,
    raiserPosition,
    raiseCount,
    hand,
    correct: advice.action,
    reasoning: advice.reasoning,
    tableSize,
  }
}

// ---------------- モード④: 相手レンジ予想 (候補レンジから選択) ----------------
export type RangePredictionAction = 'open' | '3bet'
export type RangeStreet = 'preflop' | 'flop' | 'turn' | 'river'
export type RangeQuizPostflopAction = 'bet' | 'call'

export interface RangePredictionCandidate {
  hands: string[]
  /** 正解/不正解の答え合わせ後に開示する説明ラベル (回答前はUI側で隠す) */
  labelJa: string
}

export interface RangePredictionQuestion {
  tableSize: number
  raiserPosition: Position
  preflopAction: RangePredictionAction
  street: RangeStreet
  /** street==='preflop' の場合は空配列 */
  board: Card[]
  /** street!=='preflop' の場合のみ存在 */
  postflopAction?: RangeQuizPostflopAction
  scenarioJa: string
  candidates: RangePredictionCandidate[]
  correctIndex: number
  reasoning: string
}

export interface RangePredictionOptions {
  tableSize?: number
  preflopActions?: RangePredictionAction[]
  streets?: RangeStreet[]
  postflopActions?: RangeQuizPostflopAction[]
}

const RANGE_ACTION_JA: Record<RangePredictionAction, string> = {
  open: 'オープンレイズ',
  '3bet': '3ベット(リレイズ)',
}

const POSTFLOP_ACTION_JA: Record<RangeQuizPostflopAction, string> = {
  bet: 'ベット',
  call: 'コール',
}

const RANGE_STREET_JA: Record<RangeStreet, string> = {
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
}

const STREET_BOARD_LEN: Record<Exclude<RangeStreet, 'preflop'>, number> = { flop: 3, turn: 4, river: 5 }

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function rangeSignature(hands: string[]): string {
  return [...hands].sort().join(',')
}

/** ダミープールから、正解(excludeSig)と内容が重複しないものを最大n個、シャッフルして選ぶ。 */
function pickUniqueDummies(pool: RangePredictionCandidate[], excludeSig: string, n: number): RangePredictionCandidate[] {
  const seenSigs = new Set([excludeSig])
  const deduped: RangePredictionCandidate[] = []
  for (const d of pool) {
    const sig = rangeSignature(d.hands)
    if (seenSigs.has(sig)) continue
    seenSigs.add(sig)
    deduped.push(d)
  }
  return shuffleArray(deduped).slice(0, n)
}

function randomBoard(len: number): Card[] {
  return shuffle(createDeck()).slice(0, len)
}

export function makeRangePredictionQuestion(opts: RangePredictionOptions = {}): RangePredictionQuestion {
  const tableSize = opts.tableSize ?? (6 + Math.floor(Math.random() * 3))
  const order = actionOrder(tableSize)
  const candidatePositions = order.filter(p => p !== 'BB')

  const preflopActionPool: RangePredictionAction[] =
    opts.preflopActions && opts.preflopActions.length > 0 ? opts.preflopActions : ['open', '3bet']
  const preflopAction = pick(preflopActionPool)
  const raiserPosition = pick(candidatePositions)
  const preflopRangeHands = [...(preflopAction === 'open' ? OPEN_RANGES[raiserPosition] : THREEBET_RANGES[raiserPosition])]

  const streetPool: RangeStreet[] = opts.streets && opts.streets.length > 0 ? opts.streets : ['preflop', 'flop', 'turn', 'river']
  const street = pick(streetPool)

  if (street === 'preflop') {
    const correctHands = preflopRangeHands
    const correctLabel = `${raiserPosition}の${RANGE_ACTION_JA[preflopAction]}レンジ (${correctHands.length}ハンド)`
    const correctSig = rangeSignature(correctHands)

    // ダミー候補プール: 全ポジション×全アクションから、正解と同一内容のものを除外
    const dummyPool: RangePredictionCandidate[] = []
    for (const pos of candidatePositions) {
      for (const act of ['open', '3bet'] as RangePredictionAction[]) {
        if (pos === raiserPosition && act === preflopAction) continue
        const hands = [...(act === 'open' ? OPEN_RANGES[pos] : THREEBET_RANGES[pos])]
        dummyPool.push({ hands, labelJa: `${pos}の${RANGE_ACTION_JA[act]}レンジ (${hands.length}ハンド)` })
      }
    }
    const chosenDummies = pickUniqueDummies(dummyPool, correctSig, 2)

    const correctCandidate: RangePredictionCandidate = { hands: correctHands, labelJa: correctLabel }
    const candidates = shuffleArray([correctCandidate, ...chosenDummies])
    const correctIndex = candidates.indexOf(correctCandidate)

    const scenarioJa = `${tableSize}人テーブル。${raiserPosition}が${RANGE_ACTION_JA[preflopAction]}してきました。`
    const reasoning = `${raiserPosition}は${tableSize}人テーブルで${RANGE_ACTION_JA[preflopAction]}を行うとき、${correctHands.length}ハンドのレンジ(${correctLabel})で行動します。`

    return { tableSize, raiserPosition, preflopAction, street, board: [], scenarioJa, candidates, correctIndex, reasoning }
  }

  // ---- ポストフロップ(flop/turn/river): プリフロップの開始レンジをボード+ベット/コールで絞り込む ----
  const boardLen = STREET_BOARD_LEN[street]
  const postflopActionPool: RangeQuizPostflopAction[] =
    opts.postflopActions && opts.postflopActions.length > 0 ? opts.postflopActions : ['bet', 'call']
  const otherPositions = candidatePositions.filter(p => p !== raiserPosition)

  let board: Card[] = []
  let postflopAction: RangeQuizPostflopAction = pick(postflopActionPool)
  let correctHands: string[] = []
  let correctSig = ''
  let chosenDummies: RangePredictionCandidate[] = []

  // 狭いレンジ×特定のボードでは、ベット/コール/素のレンジ/別ポジションの絞り込み結果が
  // 偶然すべて同一内容になり候補が1つに潰れることがある。ダミーが1つも確保できなければ
  // ボード・アクション・比較ポジションを変えて再抽選する(通常は1回で成立)。
  for (let attempt = 0; attempt < 8; attempt++) {
    board = randomBoard(boardLen)
    const preflopCombos = expandRange(new Set(preflopRangeHands), board)
    if (preflopCombos.length === 0) continue

    postflopAction = pick(postflopActionPool)
    const otherPostflopAction: RangeQuizPostflopAction = postflopAction === 'bet' ? 'call' : 'bet'

    correctHands = [...combosToHandSet(narrowRangeByAction(preflopCombos, board, postflopAction))]
    correctSig = rangeSignature(correctHands)

    // ダミー1: 同じ状況で別のアクション(ベット⇔コール)を取った場合のレンジ
    const dummyOtherHands = [...combosToHandSet(narrowRangeByAction(preflopCombos, board, otherPostflopAction))]
    // ダミー2: ボードでの絞り込みを反映しない素のプリフロップレンジ
    const dummyRawHands = [...combosToHandSet(preflopCombos)]
    // ダミー3: 別ポジションが同じ状況(同アクション・同ボード)で絞り込んだ場合のレンジ
    const dummyPosition = pick(otherPositions.length > 0 ? otherPositions : candidatePositions)
    const dummyPositionRangeHands = [...(preflopAction === 'open' ? OPEN_RANGES[dummyPosition] : THREEBET_RANGES[dummyPosition])]
    const dummyPositionHands = [...combosToHandSet(
      narrowRangeByAction(expandRange(new Set(dummyPositionRangeHands), board), board, postflopAction),
    )]

    const dummyPool: RangePredictionCandidate[] = [
      {
        hands: dummyOtherHands,
        labelJa: `${raiserPosition}の${POSTFLOP_ACTION_JA[otherPostflopAction]}レンジ (${RANGE_STREET_JA[street]}, ${dummyOtherHands.length}ハンド)`,
      },
      {
        hands: dummyRawHands,
        labelJa: `${raiserPosition}の素のプリフロップレンジ (ボード未反映, ${dummyRawHands.length}ハンド)`,
      },
      {
        hands: dummyPositionHands,
        labelJa: `${dummyPosition}の${POSTFLOP_ACTION_JA[postflopAction]}レンジ (${RANGE_STREET_JA[street]}, ${dummyPositionHands.length}ハンド)`,
      },
    ]
    chosenDummies = pickUniqueDummies(dummyPool, correctSig, 2)
    if (chosenDummies.length > 0) break
  }

  // 最終フォールバック: 何度再抽選してもダミーが正解と同一内容になる極端なケース用。
  // 全レンジ(169ハンド)は通常の絞り込み結果と内容が一致しないため確実に異なる候補になる。
  if (chosenDummies.length === 0) {
    chosenDummies = [{ hands: [...FULL_RANGE], labelJa: `全レンジ (絞り込みなし, ${FULL_RANGE.size}ハンド)` }]
  }

  const boardStr = board.map(cardLabel).join(' ')
  const correctLabel = `${raiserPosition}の${POSTFLOP_ACTION_JA[postflopAction]}レンジ (${RANGE_STREET_JA[street]}, ${correctHands.length}ハンド)`
  const correctCandidate: RangePredictionCandidate = { hands: correctHands, labelJa: correctLabel }
  const candidates = shuffleArray([correctCandidate, ...chosenDummies])
  const correctIndex = candidates.indexOf(correctCandidate)

  const scenarioJa = `${tableSize}人テーブル。${raiserPosition}がプリフロップで${RANGE_ACTION_JA[preflopAction]}。${RANGE_STREET_JA[street]} ${boardStr} で、${raiserPosition}が${POSTFLOP_ACTION_JA[postflopAction]}してきました。`
  const reasoning = `${raiserPosition}のプリフロップレンジ(${preflopRangeHands.length}ハンド)のうち、${RANGE_STREET_JA[street]}のボード ${boardStr} で${POSTFLOP_ACTION_JA[postflopAction]}したことを踏まえると、強い手やドロー中心(ブラフの一部を含む)に絞られ、${correctHands.length}ハンドのレンジになります。`

  return {
    tableSize, raiserPosition, preflopAction, street, board, postflopAction,
    scenarioJa, candidates, correctIndex, reasoning,
  }
}
