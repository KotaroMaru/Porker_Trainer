import { computeExploitability, selfPlayValue } from './exploitability'
import { buildBlockingContexts, buildScoreContexts, computeShowdownValue, computeFoldValue } from './terminalEval'
import type { BlockingContext, ScoreContext } from './terminalEval'

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
  /**
   * このターミナル時点で確定している場のカード(cardKey形式の文字列、例:"13c")。
   * チャンスノード(次の共有カードを配る)を経由する木では、分岐ごとに異なる
   * ボードでショーダウンを迎えるため、スコア計算はターミナルごとにこのboardを
   * 使って行う必要がある。チャンスノードを持たない単一ボードのゲーム
   * (Kuhnポーカー等)ではboardを省略でき、その場合CfrGame.scoreは第2引数を無視してよい。
   */
  board?: string[]
}

export interface DecisionNode {
  kind: 'decision'
  player: PlayerIdx
  actionLabels: string[]
  children: TreeNode[] // actionLabelsと同じ順序・同じ長さ
  /**
   * この決断時点でのポット(bb、このストリート開始時点のポット込み)。UI表示用
   * (bb換算額の算出等)。actionTree.tsが構築する木では必ず設定される。トイゲーム
   * (Kuhnポーカー等、bb建てのベッティング抽象を使わない検証用ゲーム)では省略可。
   */
  potBb?: number
  /** この決断時点までに各プレイヤーがこのストリートで投入済みの額(bb)。UI表示用。同上、省略可。 */
  contributedBb?: [number, number]
}

export interface ChanceNode {
  kind: 'chance'
  /** 各枝が1枚のカードに対応(例: "Kc")。childrenと同じ順序・同じ長さ。 */
  cards: string[]
  children: TreeNode[]
  /**
   * このチャンスノードに到達した時点(=前のストリートのベッティング完了時点)で
   * 各プレイヤーがそのストリートで投入していた額(bb)。ソルバー本体(walk等)は
   * 使わない、trainer層のUI/簿記専用のオプションフィールド(buildTurnSubgameTree
   * のリバー展開時のみ設定される)。DecisionNode.potBb/contributedBbと同じ位置づけ。
   */
  contributed?: [number, number]
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
   * 手の絶対的な強さスコアを返す(値そのものに意味はなく、大小関係のみが使われる。
   * 同点=引き分け)。第2引数はそのターミナルのTerminalNode.board(存在すれば)。
   * ボードに依存しないトイゲーム(Kuhn等)では第2引数を無視してよい。
   * h0側/h1側どちらの手が渡されても同じ基準でスコアを返す、単一のスケールに
   * すること(以前はcompare(h0,h1)形式で引数順序に依存するバグを2度踏んだため、
   * 単項のscore関数に設計変更した)。
   */
  score: (h: Hand, board?: string[]) => number
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
  /** checkEveryIterationsごとに呼ばれる進捗コールバック(Worker側の進捗表示用)。 */
  onProgress?: (iterationsRun: number, exploitability: number) => void
  /** trueを返すようになったら次のチェックポイントで解を打ち切る(キャンセル用)。 */
  shouldCancel?: () => boolean
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
  /** currentStrategyの結果を書き込む再利用バッファ([h*actionCount+a]でアクセス)。
   *  各ノードは1反復につき1回だけ評価される(このモジュール冒頭の前提)ため、
   *  ノード専属のバッファを使い回しても上書き競合は起きない。 */
  stratScratch: Float64Array
}

export function blockedByCard(cardsOfHand: string[], card: string): boolean {
  return cardsOfHand.includes(card)
}

/**
 * 1回のソルブを通して共有する評価用キャッシュ。
 * - ブロッキング構造(BlockingContext)はボードに依存しないため1回だけ構築する。
 * - スコアコンテキスト(ScoreContext)はボードにのみ依存する。ターミナルは
 *   数千個あってもユニークなボードはリバーカード数(≈48)しかないため、
 *   ターミナル単位ではなく**ボード文字列単位**でキャッシュする。
 *
 * かつてはsolveCfr/selfPlayValue/bestResponseValueがそれぞれターミナル単位の
 * キャッシュを別々に持っており、スコア表構築(全コンボ×全ターミナルの役判定
 * ≈230万回のevaluate≈37秒)が1回のソルブ+収束判定で5回も再実行されていた。
 * これがP2ベンチマークで実行時間の96%を占めるボトルネックだった。
 * ボード単位キー(48種)+全関数共有により、構築コストは1ソルブあたり
 * 48ボード×352コンボ≈1.7万回のevaluate(<1秒)まで下がる。
 */
export interface EvalCache {
  blockCtx: [BlockingContext, BlockingContext]
  getScoreContexts: (node: TerminalNode) => [ScoreContext, ScoreContext]
}

export function createEvalCache<Hand>(game: CfrGame<Hand>): EvalCache {
  const [uni0, uni1] = game.players
  const cards0 = uni0.hands.map(uni0.cards)
  const cards1 = uni1.hands.map(uni1.cards)
  const n0 = uni0.hands.length
  const n1 = uni1.hands.length
  const blockCtx = buildBlockingContexts(cards0, cards1)
  const byBoard = new Map<string, [ScoreContext, ScoreContext]>()
  function getScoreContexts(node: TerminalNode): [ScoreContext, ScoreContext] {
    // boardなし(Kuhn等の単一ボードゲーム)はキー''で全ターミナル共有になる。
    // その場合scoreはboard非依存なので共有して正しい。
    const key = node.board ? node.board.join(',') : ''
    let ctx = byBoard.get(key)
    if (!ctx) {
      const scores0 = new Float64Array(n0)
      for (let h0 = 0; h0 < n0; h0++) scores0[h0] = game.score(uni0.hands[h0], node.board)
      const scores1 = new Float64Array(n1)
      for (let h1 = 0; h1 < n1; h1++) scores1[h1] = game.score(uni1.hands[h1], node.board)
      ctx = buildScoreContexts(scores0, scores1, blockCtx[0], blockCtx[1])
      byBoard.set(key, ctx)
    }
    return ctx
  }
  return { blockCtx, getScoreContexts }
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

  // ブロッキング構造+ボード単位スコア表の共有キャッシュ。walk本体だけでなく
  // exploitability測定(selfPlayValue/bestResponseValue)にも渡して再構築を防ぐ。
  const evalCache = createEvalCache(game)
  const [blockCtx0, blockCtx1] = evalCache.blockCtx

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
        stratScratch: new Float64Array(handCount * actionCount),
      }
      regretTable.set(node, e)
    }
    return e
  }

  /** regret-matchingによる現在戦略。戻り値はentry専属の再利用バッファ([h*actionCount+a])。 */
  function currentStrategy(e: RegretEntry): Float64Array {
    const strat = e.stratScratch
    const ac = e.actionCount
    const uniform = 1 / ac
    for (let h = 0; h < e.handCount; h++) {
      const base = h * ac
      let posSum = 0
      for (let a = 0; a < ac; a++) {
        const r = e.regretSum[base + a]
        const pos = r > 0 ? r : 0
        strat[base + a] = pos
        posSum += pos
      }
      if (posSum > 0) {
        for (let a = 0; a < ac; a++) strat[base + a] /= posSum
      } else {
        for (let a = 0; a < ac; a++) strat[base + a] = uniform
      }
    }
    return strat
  }

  // スコアコンテキストはevalCache(ボード単位キャッシュ)から取得する。
  // foldターミナルはスコアを一切使わないため、ボードが未確定でも安全な
  // computeFoldValue(BlockingContextのみ使用)だけを呼ぶ。
  const getScoreContexts = evalCache.getScoreContexts

  function terminalValue(node: TerminalNode, reach0: Float64Array, reach1: Float64Array): [Float64Array, Float64Array] {
    const [c0, c1] = node.contributed

    if (node.outcome.kind === 'fold') {
      const { foldedPlayer } = node.outcome
      const net0 = foldedPlayer === 1 ? node.potBb - c0 : -c0
      const net1 = foldedPlayer === 0 ? node.potBb - c1 : -c1
      const v0 = computeFoldValue(blockCtx0, reach1, net0)
      const v1 = computeFoldValue(blockCtx1, reach0, net1)
      return [v0, v1]
    }

    const [scoreCtx0, scoreCtx1] = getScoreContexts(node)
    const v0 = computeShowdownValue(scoreCtx0, blockCtx0, reach1, node.potBb, c0)
    const v1 = computeShowdownValue(scoreCtx1, blockCtx1, reach0, node.potBb, c1)
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
      let childSum0 = 0
      let childSum1 = 0
      for (let h0 = 0; h0 < n0; h0++) {
        const v = blockedByCard(cards0[h0], card) ? 0 : reach0[h0]
        childReach0[h0] = v
        childSum0 += v
      }
      for (let h1 = 0; h1 < n1; h1++) {
        const v = blockedByCard(cards1[h1], card) ? 0 : reach1[h1]
        childReach1[h1] = v
        childSum1 += v
      }
      const [cv0, cv1] = walk(child, childReach0, childReach1, childSum0, childSum1, iter)
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

  function decisionValue(node: DecisionNode, reach0: Float64Array, reach1: Float64Array, sum0: number, sum1: number, iter: number): [Float64Array, Float64Array] {
    const acting = node.player
    const actingHandCount = acting === 0 ? n0 : n1
    const entry = getEntry(node, actingHandCount)
    const strategy = currentStrategy(entry)
    const actionCount = node.actionLabels.length

    const childValues: [Float64Array, Float64Array][] = []
    for (let a = 0; a < actionCount; a++) {
      if (acting === 0) {
        const newReach0 = new Float64Array(n0)
        let newSum0 = 0
        for (let h = 0; h < n0; h++) {
          const v = reach0[h] * strategy[h * actionCount + a]
          newReach0[h] = v
          newSum0 += v
        }
        childValues.push(walk(node.children[a], newReach0, reach1, newSum0, sum1, iter))
      } else {
        const newReach1 = new Float64Array(n1)
        let newSum1 = 0
        for (let h = 0; h < n1; h++) {
          const v = reach1[h] * strategy[h * actionCount + a]
          newReach1[h] = v
          newSum1 += v
        }
        childValues.push(walk(node.children[a], reach0, newReach1, sum0, newSum1, iter))
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
        for (let a = 0; a < actionCount; a++) val += strategy[h * actionCount + a] * childValues[a][0][h]
        nodeValue[h] = val
      }
      for (let h = 0; h < n0; h++) {
        for (let a = 0; a < actionCount; a++) {
          const idx = h * actionCount + a
          const prevR = entry.regretSum[idx]
          const discounted = prevR > 0 ? prevR * posCoef : prevR * negCoef
          const instRegret = childValues[a][0][h] - nodeValue[h]
          entry.regretSum[idx] = discounted + instRegret
          entry.strategySum[idx] += stratWeight * reach0[h] * strategy[idx]
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
        for (let a = 0; a < actionCount; a++) val += strategy[h * actionCount + a] * childValues[a][1][h]
        nodeValue[h] = val
      }
      for (let h = 0; h < n1; h++) {
        for (let a = 0; a < actionCount; a++) {
          const idx = h * actionCount + a
          const prevR = entry.regretSum[idx]
          const discounted = prevR > 0 ? prevR * posCoef : prevR * negCoef
          const instRegret = childValues[a][1][h] - nodeValue[h]
          entry.regretSum[idx] = discounted + instRegret
          entry.strategySum[idx] += stratWeight * reach1[h] * strategy[idx]
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

  // 両側のリーチ確率が完全にゼロの部分木は、どちらの手からも到達不可能であり
  // 寄与が厳密にゼロ(v0はreach1に、v1はreach0に線形依存するため)。無損失な
  // プルーニングとして、ターミナル評価/チャンス展開/後悔更新を丸ごとスキップする。
  // sum0/sum1は呼び出し側(decisionValue/chanceValue)がリーチ配列構築と同じループで
  // 計算済みの値を渡すため、ここでの追加スキャンは発生しない。
  function walk(node: TreeNode, reach0: Float64Array, reach1: Float64Array, sum0: number, sum1: number, iter: number): [Float64Array, Float64Array] {
    if (sum0 === 0 && sum1 === 0) return [new Float64Array(n0), new Float64Array(n1)]
    if (node.kind === 'terminal') return terminalValue(node, reach0, reach1)
    if (node.kind === 'chance') return chanceValue(node, reach0, reach1, iter)
    return decisionValue(node, reach0, reach1, sum0, sum1, iter)
  }

  function getAverageStrategy(node: DecisionNode): number[][] {
    const actionCount = node.actionLabels.length
    const handCount = node.player === 0 ? n0 : n1
    return averageStrategyFromEntry(regretTable.get(node), actionCount, handCount)
  }

  let iterationsRun = 0
  let exploitability = Infinity
  // ルートのリーチ和は反復間で不変(initialReachは固定)なので1回だけ計算する。
  const initialSum0 = uni0.initialReach.reduce((a, b) => a + b, 0)
  const initialSum1 = uni1.initialReach.reduce((a, b) => a + b, 0)

  for (let t = 1; t <= maxIterations; t++) {
    const reach0 = new Float64Array(uni0.initialReach)
    const reach1 = new Float64Array(uni1.initialReach)
    // 戻り値(瞬間戦略でのCFR値)は後悔値・平均戦略の更新にのみ使う。振動するため
    // ゲーム値の算出には使わない(平均戦略ベースのselfPlayValueを別途使う)。
    walk(game.root, reach0, reach1, initialSum0, initialSum1, t)
    iterationsRun = t

    if (t % checkEvery === 0 || t === maxIterations) {
      exploitability = computeExploitability(game, getAverageStrategy, evalCache)
      opts.onProgress?.(t, exploitability)
      if (exploitability < targetExploitability) break
      if (opts.shouldCancel?.()) break
    }
  }

  const gameValue = selfPlayValue(game, getAverageStrategy, evalCache)

  return {
    game,
    iterationsRun,
    exploitability,
    getStrategy: (node) => ({ actionLabels: node.actionLabels, frequencies: getAverageStrategy(node) }),
    gameValue,
  }
}
