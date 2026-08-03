/// <reference types="node" />
// P12 Phase B: flopIso.tsの数値・正当性テスト(GTOドメイン最重要ルール適用領域)。
//
// 1. 往復: 収録95フロップそれぞれにスート置換を適用した別表記から、元の収録フロップへ
//    正しく戻ることを全件で検証する。
// 2. 全単射性: 返るsuitMapが4スートの全単射であること、適用後にカード重複が
//    発生しないこと(フロップ+手札+ターン+リバーの最大7枚で検証)。
// 3. カバー率の固定化: 全22100フロップ組み合わせに対する成功率を回帰テストとして固定する。
// 4. ★スート対称性の実証(このPhaseの核心): 盤面に登場しないスート同士を入れ替えた
//    2つの手札で、computeCustomHandReviewの頻度・EVが数値的に一致することを検証する。
//    これが崩れていたら、スート置換読み替え機能自体が数学的に無効なので、Phase Dへ進まず
//    エスカレーションする(AGENTS.mdのGTOドメイン最重要ルール・タスクパケット記載の条件)。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalFlopKey, findIsomorphicStoredFlop, applySuitMap, isBijectiveSuitMap } from './flopIso'
import { FLOPS } from './data/flops'
import { getScenario } from './data/scenarios'
import { boardFromFlop } from './trainer/gameFlow'
import { createInProcessProviderFactory } from './trainer/inProcessProviderFactory'
import { computeCustomHandReview, type CustomHandInput } from './trainer/customHandReview'
import { cardKey, createDeck } from '../engine/deck'
import type { Card, Suit } from '../engine/types'

describe('flopIso: 往復・全単射性', () => {
  // 非自明な置換(4巡回: c→d→h→s→c)を全95収録フロップに適用し、元へ戻ることを検証する。
  const cycle: Record<Suit, Suit> = { c: 'd', d: 'h', h: 's', s: 'c' }

  it('収録フロップ全件で、スート置換した別表記から元の収録フロップへ戻る(往復)', () => {
    // 件数は段階的に増える(P15段階B-1で95→300)。件数そのものはflops.test.tsで検査する。
    expect(FLOPS.length).toBeGreaterThanOrEqual(95)
    for (const flop of FLOPS) {
      const original = boardFromFlop(flop)
      const relabeled = applySuitMap(original, cycle)

      const match = findIsomorphicStoredFlop(relabeled)
      expect(match, `flop=${flop.cards.join('')}`).not.toBeNull()
      expect(match!.flop.cards.join(''), `flop=${flop.cards.join('')}`).toBe(flop.cards.join(''))
      expect(isBijectiveSuitMap(match!.suitMap), `flop=${flop.cards.join('')}: suitMap not bijective`).toBe(true)

      // relabeledへmatch.suitMapを適用すると、元のカード集合(順不同)へ戻る。
      const recovered = applySuitMap(relabeled, match!.suitMap)
      expect(new Set(recovered.map(cardKey)), `flop=${flop.cards.join('')}`).toEqual(new Set(original.map(cardKey)))
    }
  })

  it('収録フロップは互いに異なる同型クラスに属する(代表フロップが同型で重複していない)', () => {
    const keys = new Set(FLOPS.map((f) => canonicalFlopKey(boardFromFlop(f))))
    expect(keys.size).toBe(FLOPS.length)
  })

  it('全単射性: フロップ+手札+ターン+リバー(最大7枚)にsuitMapを適用してもカードの重複が生じない', () => {
    const flop = FLOPS.find((f) => f.cards.join('') === 'AsQsJs')
    if (!flop) throw new Error('flop fixture not found')
    const board = boardFromFlop(flop)
    const hand: Card[] = [
      { rank: 10, suit: 'c' },
      { rank: 9, suit: 'd' },
    ]
    const turn: Card = { rank: 2, suit: 'h' }
    const river: Card = { rank: 3, suit: 'd' }
    const sevenCards = [...board, ...hand, turn, river]
    expect(new Set(sevenCards.map(cardKey)).size).toBe(7) // 前提: 元のカードに重複が無いこと

    const relabeledBoard = applySuitMap(board, cycle)
    const match = findIsomorphicStoredFlop(relabeledBoard)
    expect(match).not.toBeNull()

    const relabeledSeven = [...relabeledBoard, ...applySuitMap(hand, cycle), applySuitMap([turn], cycle)[0], applySuitMap([river], cycle)[0]]
    const remapped = applySuitMap(relabeledSeven, match!.suitMap)
    expect(new Set(remapped.map(cardKey)).size, 'suitMap適用後もカード重複が発生しない').toBe(7)
  })
})

describe('flopIso: カバー率の固定化(回帰)', () => {
  it('全22100フロップ組み合わせに対する読み替え成功率は3728/22100(16.87%)で固定されている', () => {
    const deck = createDeck()
    let total = 0
    let hit = 0
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        for (let k = j + 1; k < deck.length; k++) {
          total++
          if (findIsomorphicStoredFlop([deck[i], deck[j], deck[k]])) hit++
        }
      }
    }
    expect(total).toBe(22100)
    // 事前調査(簡易実装での見積もり)では1393/22100(5.0%)と見積もっていたが、
    // 簡易実装は同ランクの同着カード(ペア等)を含む盤面でタイブレークが物理的な
    // スート表記に依存しており、スート置換で不変ではなかった(=一部の同型フロップを
    // 誤って「別クラス」と判定していた)。上のcanonicalOrdering()は同ランクの全並びを
    // 試して辞書順最小のパターンを正規形として選ぶことでこれを修正しており、
    // 「往復」テスト(収録フロップ全件)で正しさを検証済み。
    //
    // 2026-08-03(P15 段階B-1): 収録フロップを95→300へ拡張したため
    // 1420(6.43%)→3728(16.87%)へ更新。倍率2.6倍は収録数の増加(3.16倍)に対応する。
    // 妥当性の確認: 300クラス×平均軌道サイズ(22100/1755≒12.6)≒3,778 と実測3,728が
    // ほぼ一致しており、収録クラスの軌道をほぼ取りこぼしなく拾えている。
    // 収録フロップを増減させた場合はこの回帰値を意図的に更新すること。
    expect(hit).toBe(3728)
  })
})

// ---- ★スート対称性の実証(このPhaseの核心) ----
// computeCustomHandReviewはloadFlopSolution経由(fetch)でフロップ解を取得するため、
// customHandReview.test.tsと同じ手法でglobalThis.fetchを実.binファイルへスタブする。
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

describe('flopIso: ★スート対称性の実証(GTOドメイン最重要ルール)', () => {
  // srp_btn_vs_bb / AsQsJs(モノトーン、盤面が使うスートは's'のみ)。
  // customHandReview.test.tsで既に使われている実.binフィクスチャを再利用する。
  const scenario = getScenario('srp_btn_vs_bb')
  const flop = FLOPS.find((f) => f.cards.join('') === 'AsQsJs')
  if (!flop) throw new Error('flop fixture not found')

  // buildStreetTree/buildTurnSubgameTreeは常にfirstToAct:0で構築されるため
  // (fullHandFlow.ts参照)、「両者ずっとチェック」の行動列は盤面・スート・rngに依らず
  // 常にこの形になる(木構造から導出される決定的な事実、手で構築してよい)。
  const checkCheck = [
    { seat: 0 as const, label: 'check' },
    { seat: 1 as const, label: 'check' },
  ]
  const streetActions: CustomHandInput['streetActions'] = { flop: checkCheck, turn: checkCheck, river: checkCheck }

  // 盤面が使わないスート('c'と'd')を入れ替えた2つの手札。盤面から見て対称なので、
  // GTO戦略(頻度・EV)が数値的に一致するはずという「スート対称性」を検証する。
  const comboA: [Card, Card] = [{ rank: 10, suit: 'c' }, { rank: 9, suit: 'd' }]
  const comboB: [Card, Card] = [{ rank: 10, suit: 'd' }, { rank: 9, suit: 'c' }]
  // ターン/リバーは盤面が使わないもう1つのスート('h')に固定し、comboの入替と無関係にする。
  const turnCard: Card = { rank: 2, suit: 'h' }
  const riverCard: Card = { rank: 4, suit: 'h' }

  it('盤面に登場しないスート同士(c/d)を入れ替えた2つの手札で、全決断の頻度・EVが数値的に一致する', async () => {
    const inputA: CustomHandInput = { scenario, flop, turnCard, riverCard, userSeat: 0, userCombo: comboA, streetActions }
    const inputB: CustomHandInput = { scenario, flop, turnCard, riverCard, userSeat: 0, userCombo: comboB, streetActions }

    const reviewA = await computeCustomHandReview(inputA, createInProcessProviderFactory())
    const reviewB = await computeCustomHandReview(inputB, createInProcessProviderFactory())

    expect(reviewA.decisions.length).toBeGreaterThan(0)
    expect(reviewA.decisions.length).toBe(reviewB.decisions.length)

    for (let i = 0; i < reviewA.decisions.length; i++) {
      const a = reviewA.decisions[i].grading
      const b = reviewB.decisions[i].grading
      const msg = `decisions[${i}]`
      expect(a.verdict, `${msg}.verdict`).toBe(b.verdict)
      expect(a.bestLabel, `${msg}.bestLabel`).toBe(b.bestLabel)
      expect(a.evLossBb, `${msg}.evLossBb`).toBeCloseTo(b.evLossBb, 6)
      expect(a.bestEvBb, `${msg}.bestEvBb`).toBeCloseTo(b.bestEvBb, 6)
      expect(a.chosenEvBb, `${msg}.chosenEvBb`).toBeCloseTo(b.chosenEvBb, 6)
      expect(a.actionBreakdown.length, `${msg}.actionBreakdown.length`).toBe(b.actionBreakdown.length)
      for (let j = 0; j < a.actionBreakdown.length; j++) {
        expect(a.actionBreakdown[j].label, `${msg}.actionBreakdown[${j}].label`).toBe(b.actionBreakdown[j].label)
        expect(a.actionBreakdown[j].freq, `${msg}.actionBreakdown[${j}].freq`).toBeCloseTo(b.actionBreakdown[j].freq, 6)
        expect(a.actionBreakdown[j].evBb, `${msg}.actionBreakdown[${j}].evBb`).toBeCloseTo(b.actionBreakdown[j].evBb, 6)
      }
    }
  }, 300_000) // computeCustomHandReviewを本番精度(既定500反復)で2回連続実行するため、
  // customHandReview.test.tsの単発180秒設定を踏まえ余裕を確保する。

  it('実例: フロップAc,Jc,Ks(ユーザーの質問例)を読み替えると収録済みのAh,Ks,Jhへスート置換され、解析が成功する', async () => {
    // ユーザーからの実際の質問例のフロップ(Ac,Jc,Ks は未収録、同型のAh,Ks,Jhのみ収録されている)。
    // 手札はユーザー例の4c,9d(オフスート・低い)ではなく、BB防御レンジに確実に入っている
    // ペア(77、フロップ未使用スートd/hを使用)を使う。4c9dはこのシナリオのBB防御レンジに
    // 含まれておらず「combo not found」になる(=レンジ外という別の制約、スート読み替えの
    // 正しさとは無関係。カスタム解析機能についてのユーザーとの過去の質疑で説明済みの制約)。
    const inputFlopCards: Card[] = [{ rank: 14, suit: 'c' }, { rank: 11, suit: 'c' }, { rank: 13, suit: 's' }]
    const inputHand: Card[] = [{ rank: 7, suit: 'd' }, { rank: 7, suit: 'h' }]

    const match = findIsomorphicStoredFlop(inputFlopCards)
    expect(match).not.toBeNull()
    expect(match!.flop.cards.join('')).toBe('AhKsJh')

    const remappedHand = applySuitMap(inputHand, match!.suitMap)
    const remappedInput: CustomHandInput = {
      scenario,
      flop: match!.flop,
      turnCard,
      riverCard,
      userSeat: 0,
      userCombo: [remappedHand[0], remappedHand[1]],
      streetActions,
    }
    const review = await computeCustomHandReview(remappedInput, createInProcessProviderFactory())
    expect(review.decisions.length).toBeGreaterThan(0)
  }, 180_000) // customHandReview.test.tsの単発実行と同じ余裕(既定精度の1回分)
})
