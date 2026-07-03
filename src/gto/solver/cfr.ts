import { computeExploitability, selfPlayValue } from './exploitability'

// Discounted CFR (Brown & Sandholm 2019) の汎用ソルバーコア。
//
// ゲーム木は「決断ノード/チャンスノード(次の共有カードを配る)/ターミナルノード」の3種類で
// 表現し、各プレイヤーの手(Hand)はインデックス配列で管理する「ベクトル形式」を採る。
// これにより1反復で「自分のレンジ全コンボ」を同時に処理でき、カード除去(ブロッキング)は
// 手同士・手とチャンスカードの重複チェックで扱う。
//
// このモジュール自体はポーカーの役判定を知らない(compare関数を外から注入される)ため、
// Kuhnポーカーのような小さい検証用ゲームにも、実際のポストフロップ部分ゲームにも
// 同じコードで対応できる。
//
// 重要な前提: チャンスノードの各分岐先(例: リバーの48通り)は、たとえ木の構造が
// 同一でも、必ず別々のノードオブジェクトとして構築すること(共有・使い回し禁止)。
// 後悔値テーブルはノードオブジェクトの参照をキーにしており、1反復につき1ノード
// オブジェクトは1回だけ評価される前提になっている。

export type PlayerIdx = 0 | 1

export interface FoldOutcome {
  kind: 'fold'
  /** foldした側 */
  foldedPlayer: PlayerIdx
}

export interface ShowdownOutcome {
  kind: 'showdown'
}

export interface TerminalNode {
  kind: 'terminal'
  /** このターミナルに到達した時点での最終ポットサイズ(bb, サブゲーム開始時のポット込み) */
  potBb: number
  /** 各プレイヤーがこのサブゲーム中に追加投入した額(bb)。サブゲーム開始時のポットは含まない。 */
  contributed: [number, number]
  outcome: FoldOutcome | ShowdownOutcome
}

export interface DecisionNode {
  kind: 'decision'
  player: PlayerIdx
  actionLabels: string[]
  children: TreeNode[] // actionLabelsと同じ順序・同じ長さ
}

export interface ChanceNode {
  kind: 'chance'
  /** 各枝が1枚のカードに対応(例: "Kc")。childrenと同じ順序・同じ長さ。 */
  cards: string[]
  children: TreeNode[]
}

export type TreeNode = TerminalNode | DecisionNode | ChanceNode

export interface HandUniverse<Hand> {
  hands: Hand[]
  /** handsと同じ長さ。レンジ内の頻度(正規化不要、0より大きい値)。 */
  initialReach: number[]
  /** ブロッキング判定用に、このハンドを構成するカード文字列を返す。 */
  cards: (h: Hand) => string[]
}

export interface CfrGame<Hand> {
  root: TreeNode
  players: [HandUniverse<Hand>, HandUniverse<Hand>]
  /**
   * 正の値ならh0が勝つ、負ならh1が勝つ、0は引き分け。
   * 重要: v1(player1視点の反実仮想値)の計算では引数の順序を入れ替えて
   * compare(uni1.hands[h1], uni0.hands[h0]) の形でも呼び出される。
   * そのためcompareは「引数の順序に依存しない」対称な実装にすること
   * (例: 全ハンドを1本の強さスケールにマッピングし compare=(a,b)=>strength(a)-strength(b)
   * とする。片方の引数がplayer0の手であることを前提にした分岐は不可)。
   */
  compare: (h0: Hand, h1: Hand) => number
}

export interface CfrOptions {
  maxIterations?: number
  /** exploitability(pot比)がこの値未満になったら早期終了。checkEveryIterations回ごとに評価。 */
  targetExploitability?: number
  checkEveryIterations?: number
  /** DCFRのパラメータ(Brown & Sandholm 2019) */
  alpha?: number
  beta?: number
  gamma?: number
}

export interface NodeStrategy {
  actionLabels: string[]
  /** hand index -> action index -> 頻度(0..1、行ごとに合計1) */
  frequencies: number[][]
}

export interface CfrSolution<Hand> {
  game: CfrGame<Hand>
  iterationsRun: number
  /** 最終的なexploitability(pot比、0以上)。小さいほど収束している。 */
  exploitability: number
  /** 平均戦略を取得する。ノードは元のroot木のオブジェクト参照で指定する。 */
  getStrategy: (node: DecisionNode) => NodeStrategy
  /** 平均戦略における各プレイヤーのゲーム値(bb)。 */
  gameValue: [number, number]
}

export interface RegretEntry {
  /** hand index -> action index -> 累積後悔値 (Float64Array、長さ = handCount*actionCount) */
  regretSum: Float64Array
  strategySum: Float64Array
  weightSum: Float64Array
  actionCount: number
  handCount: number
}

export function blockedByCard(cardsOfHand: string[], card: string): boolean {
  return cardsOfHand.includes(card)
}

export function handsBlock(cardsA: string[], cardsB: string[]): boolean {
  for (const c of cardsA) if (cardsB.includes(c)) return true
  return false
}

/** ゲーム全体のターミナルpotBbの平均。exploitabilityのpot比正規化に使う。 */
export function estimateAvgPot<Hand>(game: CfrGame<Hand>): number {
  let sum = 0
  let count = 0
  function walk(node: TreeNode) {
    if (node.kind === 'terminal') { sum += node.potBb; count++; return }
    for (const c of node.children) walk(c)
  }
  walk(game.root)
  return count > 0 ? sum / count : 1
}

function averageStrategyFromEntry(entry: RegretEntry | undefined, actionCount: number, handCount: number): number[][] {
  if (!entry) {
    return Array.from({ length: handCount }, () => new Array(actionCount).fill(1 / actionCount))
  }
  const frequencies: number[][] = []
  for (let h = 0; h < entry.handCount; h++) {
    const row = new Array<number>(actionCount)
    const w = entry.weightSum[h]
    if (w > 0) {
      for (let a = 0; a < actionCount; a++) row[a] = entry.strategySum[h * actionCount + a] / w
    } else {
      row.fill(1 / actionCount)
    }
    frequencies.push(row)
  }
  return frequencies
}

/** DCFRソルバー本体。 */
export function solveCfr<Hand>(game: CfrGame<Hand>, opts: CfrOptions = {}): CfrSolution<Hand> {
  const maxIterations = opts.maxIterations ?? 500
  const targetExploitability = opts.targetExploitability ?? 0.005 // pot比0.5%
  const checkEvery = opts.checkEveryIterations ?? 50
  const alpha = opts.alpha ?? 1.5
  const beta = opts.beta ?? 0
  const gamma = opts.gamma ?? 2

  const [uni0, uni1] = game.players
  const cards0 = uni0.hands.map(uni0.cards)
  const cards1 = uni1.hands.map(uni1.cards)
  const n0 = uni0.hands.length
  const n1 = uni1.hands.length

  // 手同士のブロッキング行列(事前計算)
  const blocked01: boolean[][] = cards0.map((c0) => cards1.map((c1) => handsBlock(c0, c1)))

  const regretTable = new Map<DecisionNode, RegretEntry>()

  function getEntry(node: DecisionNode, handCount: number): RegretEntry {
    let e = regretTable.get(node)
    if (!e) {
      const actionCount = node.actionLabels.length
      e = {
        regretSum: new Float64Array(handCount * actionCount),
        strategySum: new Float64Array(handCount * actionCount),
        weightSum: new Float64Array(handCount),
        actionCount,
        handCount,
      }
      regretTable.set(node, e)
    }
    return e
  }

  function currentStrategy(e: RegretEntry): number[][] {
    const strat: number[][] = []
    for (let h = 0; h < e.handCount; h++) {
      const row = new Array<number>(e.actionCount).fill(0)
      let posSum = 0
      for (let a = 0; a < e.actionCount; a++) {
        const r = Math.max(0, e.regretSum[h * e.actionCount + a])
        row[a] = r
        posSum += r
      }
      if (posSum > 0) {
        for (let a = 0; a < e.actionCount; a++) row[a] /= posSum
      } else {
        row.fill(1 / e.actionCount)
      }
      strat.push(row)
    }
    return strat
  }

  function terminalValue(node: TerminalNode, reach0: Float64Array, reach1: Float64Array): [Float64Array, Float64Array] {
    const v0 = new Float64Array(n0)
    const v1 = new Float64Array(n1)
    const [c0, c1] = node.contributed

    if (node.outcome.kind === 'fold') {
      const { foldedPlayer } = node.outcome
      const net0 = foldedPlayer === 1 ? node.potBb - c0 : -c0
      const net1 = foldedPlayer === 0 ? node.potBb - c1 : -c1
      for (let h0 = 0; h0 < n0; h0++) {
        let sum = 0
        for (let h1 = 0; h1 < n1; h1++) if (!blocked01[h0][h1]) sum += reach1[h1]
        v0[h0] = sum * net0
      }
      for (let h1 = 0; h1 < n1; h1++) {
        let sum = 0
        for (let h0 = 0; h0 < n0; h0++) if (!blocked01[h0][h1]) sum += reach0[h0]
        v1[h1] = sum * net1
      }
      return [v0, v1]
    }

    // showdown
    for (let h0 = 0; h0 < n0; h0++) {
      let sum = 0
      for (let h1 = 0; h1 < n1; h1++) {
        if (blocked01[h0][h1]) continue
        const cmp = game.compare(uni0.hands[h0], uni1.hands[h1])
        const share = cmp > 0 ? node.potBb : cmp === 0 ? node.potBb / 2 : 0
        sum += reach1[h1] * (share - c0)
      }
      v0[h0] = sum
    }
    for (let h1 = 0; h1 < n1; h1++) {
      let sum = 0
      for (let h0 = 0; h0 < n0; h0++) {
        if (blocked01[h0][h1]) continue
        const cmp = game.compare(uni1.hands[h1], uni0.hands[h0])
        const share = cmp > 0 ? node.potBb : cmp === 0 ? node.potBb / 2 : 0
        sum += reach0[h0] * (share - c1)
      }
      v1[h1] = sum
    }
    return [v0, v1]
  }

  function chanceValue(node: ChanceNode, reach0: Float64Array, reach1: Float64Array, iter: number): [Float64Array, Float64Array] {
    const v0 = new Float64Array(n0)
    const v1 = new Float64Array(n1)
    const cnt0 = new Float64Array(n0)
    const cnt1 = new Float64Array(n1)

    for (let bi = 0; bi < node.cards.length; bi++) {
      const card = node.cards[bi]
      const child = node.children[bi]
      const childReach0 = new Float64Array(n0)
      const childReach1 = new Float64Array(n1)
      for (let h0 = 0; h0 < n0; h0++) childReach0[h0] = blockedByCard(cards0[h0], card) ? 0 : reach0[h0]
      for (let h1 = 0; h1 < n1; h1++) childReach1[h1] = blockedByCard(cards1[h1], card) ? 0 : reach1[h1]
      const [cv0, cv1] = walk(child, childReach0, childReach1, iter)
      for (let h0 = 0; h0 < n0; h0++) {
        if (!blockedByCard(cards0[h0], card)) { v0[h0] += cv0[h0]; cnt0[h0] += 1 }
      }
      for (let h1 = 0; h1 < n1; h1++) {
        if (!blockedByCard(cards1[h1], card)) { v1[h1] += cv1[h1]; cnt1[h1] += 1 }
      }
    }
    for (let h0 = 0; h0 < n0; h0++) if (cnt0[h0] > 0) v0[h0] /= cnt0[h0]
    for (let h1 = 0; h1 < n1; h1++) if (cnt1[h1] > 0) v1[h1] /= cnt1[h1]
    return [v0, v1]
  }

  function decisionValue(node: DecisionNode, reach0: Float64Array, reach1: Float64Array, iter: number): [Float64Array, Float64Array] {
    const acting = node.player
    const actingHandCount = acting === 0 ? n0 : n1
    const entry = getEntry(node, actingHandCount)
    const strategy = currentStrategy(entry)
    const actionCount = node.actionLabels.length

    const childValues: [Float64Array, Float64Array][] = []
    for (let a = 0; a < actionCount; a++) {
      if (acting === 0) {
        const newReach0 = new Float64Array(n0)
        for (let h = 0; h < n0; h++) newReach0[h] = reach0[h] * strategy[h][a]
        childValues.push(walk(node.children[a], newReach0, reach1, iter))
      } else {
        const newReach1 = new Float64Array(n1)
        for (let h = 0; h < n1; h++) newReach1[h] = reach1[h] * strategy[h][a]
        childValues.push(walk(node.children[a], reach0, newReach1, iter))
      }
    }

    const v0 = new Float64Array(n0)
    const v1 = new Float64Array(n1)
    const posCoef = Math.pow(iter, alpha) / (Math.pow(iter, alpha) + 1)
    const negCoef = Math.pow(iter, beta) / (Math.pow(iter, beta) + 1)
    const stratWeight = Math.pow(iter, gamma)

    if (acting === 0) {
      const nodeValue = new Float64Array(n0)
      for (let h = 0; h < n0; h++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += strategy[h][a] * childValues[a][0][h]
        nodeValue[h] = val
      }
      for (let h = 0; h < n0; h++) {
        for (let a = 0; a < actionCount; a++) {
          const idx = h * actionCount + a
          const prevR = entry.regretSum[idx]
          const discounted = prevR > 0 ? prevR * posCoef : prevR * negCoef
          const instRegret = childValues[a][0][h] - nodeValue[h]
          entry.regretSum[idx] = discounted + instRegret
          entry.strategySum[idx] += stratWeight * reach0[h] * strategy[h][a]
        }
        entry.weightSum[h] += stratWeight * reach0[h]
      }
      v0.set(nodeValue)
      for (let h1 = 0; h1 < n1; h1++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += childValues[a][1][h1]
        v1[h1] = val
      }
    } else {
      const nodeValue = new Float64Array(n1)
      for (let h = 0; h < n1; h++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += strategy[h][a] * childValues[a][1][h]
        nodeValue[h] = val
      }
      for (let h = 0; h < n1; h++) {
        for (let a = 0; a < actionCount; a++) {
          const idx = h * actionCount + a
          const prevR = entry.regretSum[idx]
          const discounted = prevR > 0 ? prevR * posCoef : prevR * negCoef
          const instRegret = childValues[a][1][h] - nodeValue[h]
          entry.regretSum[idx] = discounted + instRegret
          entry.strategySum[idx] += stratWeight * reach1[h] * strategy[h][a]
        }
        entry.weightSum[h] += stratWeight * reach1[h]
      }
      v1.set(nodeValue)
      for (let h0 = 0; h0 < n0; h0++) {
        let val = 0
        for (let a = 0; a < actionCount; a++) val += childValues[a][0][h0]
        v0[h0] = val
      }
    }
    return [v0, v1]
  }

  function walk(node: TreeNode, reach0: Float64Array, reach1: Float64Array, iter: number): [Float64Array, Float64Array] {
    if (node.kind === 'terminal') return terminalValue(node, reach0, reach1)
    if (node.kind === 'chance') return chanceValue(node, reach0, reach1, iter)
    return decisionValue(node, reach0, reach1, iter)
  }

  function getAverageStrategy(node: DecisionNode): number[][] {
    const actionCount = node.actionLabels.length
    const handCount = node.player === 0 ? n0 : n1
    return averageStrategyFromEntry(regretTable.get(node), actionCount, handCount)
  }

  let iterationsRun = 0
  let exploitability = Infinity

  for (let t = 1; t <= maxIterations; t++) {
    const reach0 = new Float64Array(uni0.initialReach)
    const reach1 = new Float64Array(uni1.initialReach)
    // 戻り値(瞬間戦略でのCFR値)は後悔値・平均戦略の更新にのみ使う。振動するため
    // ゲーム値の算出には使わない(平均戦略ベースのselfPlayValueを別途使う)。
    walk(game.root, reach0, reach1, t)
    iterationsRun = t

    if (t % checkEvery === 0 || t === maxIterations) {
      exploitability = computeExploitability(game, getAverageStrategy)
      if (exploitability < targetExploitability) break
    }
  }

  const gameValue = selfPlayValue(game, getAverageStrategy)

  return {
    game,
    iterationsRun,
    exploitability,
    getStrategy: (node) => ({ actionLabels: node.actionLabels, frequencies: getAverageStrategy(node) }),
    gameValue,
  }
}
