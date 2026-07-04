// ショーダウン/フォールドのターミナル価値を計算する共有ユーティリティ。
// cfr.ts(訓練ループ)・exploitability.ts(自己対戦/ベストレスポンス計算)の両方から使う。
//
// 背景(3段階の最適化を経ている):
// 1. 当初は各(h0,h1)ペアごとにgame.compareを呼ぶ素朴なO(N×M)実装だったが、実際の
//    レンジ規模(コンボ数百)×木の規模(ターミナル数千〜1万)×反復数(数百)では
//    演算回数が爆発し、Node上でも1回のソルブに数分かかった。
// 2. スコアを事前ソートしたスイープ(勝敗の集計を二分探索で行う)+カードごとの
//    「スコア順位置リスト」+reach加重prefix sumによる包除原理(inclusion-exclusion)で
//    ブロッキング補正も含めてO(N log M)程度に抑えた。手が最大2枚のカードで構成される
//    前提(hold'em)を利用し、「カードAを含む相手コンボの勝ち/引分reach」-「カードBを
//    含む〜」-「AとB両方を含む(=特定の1コンボ、高々1件)の重複分」で正しい値を求める。
// 3. それでも1呼び出し50μs超×反復あたり1.2万ターミナル×数百反復が支配的コスト
//    (実測で実行時間の7割)だったため、ホットパスから文字列Mapとクロージャ生成と
//    二分探索を全廃した:
//    - カード文字列を整数スロットにintern(両サイド共有)し、Map<string,→をただの配列に
//    - 反復間で不変な量(勝ち/引分のスコア境界、カード別位置リスト内の境界、ペア重複
//      コンボのインデックスとスコア比較)はすべて構築時に事前計算
//    - 呼び出しごとに変わるのはreach加重prefix sumだけなので、その分のバッファを
//      コンテキスト内に確保して再利用(シングルスレッド前提)
//    これにより1呼び出しあたり「純粋なフラット配列演算のみ」になる。

/** ソート済み整数配列(昇順)中でvalue未満の値が現れる最初のインデックス。 */
function lowerBoundInt(sorted: Int32Array, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** スコア配列(昇順ソート済み)中でscore未満の値が現れる最初のインデックス。 */
function lowerBound(sortedScores: Float64Array, score: number): number {
  let lo = 0
  let hi = sortedScores.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedScores[mid] < score) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** スコア配列(昇順ソート済み)中でscoreより大きい値が現れる最初のインデックス。 */
function upperBound(sortedScores: Float64Array, score: number): number {
  let lo = 0
  let hi = sortedScores.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedScores[mid] <= score) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 片サイド分のブロッキング構造。カードは文字列ではなく整数スロット
 * (両サイド共有のintern表slotOfによる番号)で扱う。
 */
export interface BlockingContext {
  nMine: number
  nOpp: number
  /** カード文字列→スロット番号。両サイドの全手札カードをinternした共有表。 */
  slotOf: Map<string, number>
  /** 自分の手mの1枚目/2枚目のカードスロット。該当カードがない場合は-1
   *  (Kuhn等の1枚手はmyCardB=-1、カードなしの抽象ゲームは両方-1)。 */
  myCardA: Int32Array
  myCardB: Int32Array
  /** 自分の手mと2枚とも同じカードを持つ相手手インデックス(なければ-1)。
   *  hold'emでは高々1つ。包除原理の重複戻し分。 */
  pairOppIdx: Int32Array
  /** スロット→そのカードを含む相手手インデックス一覧(該当なしは空配列)。 */
  oppIndicesBySlot: Int32Array[]
  /** 自分の手に現れるスロットの一覧(カード別reach集計はこれだけ計算すれば足りる)。 */
  neededSlots: Int32Array
  /** computeFoldValue用スクラッチ(スロット別reach合計)。シングルスレッド前提で再利用。 */
  slotReachScratch: Float64Array
}

/** 両サイド分のBlockingContextを構築する(ボードに依存しないため対局ごとに1回だけでよい)。 */
export function buildBlockingContexts(cards0: string[][], cards1: string[][]): [BlockingContext, BlockingContext] {
  // 両サイドの全カードを共有intern表に登録する
  const slotOf = new Map<string, number>()
  function intern(card: string): number {
    let s = slotOf.get(card)
    if (s === undefined) { s = slotOf.size; slotOf.set(card, s) }
    return s
  }
  for (const cs of cards0) for (const c of cs) intern(c)
  for (const cs of cards1) for (const c of cs) intern(c)
  const slotCount = slotOf.size

  function buildOne(myCards: string[][], oppCards: string[][]): BlockingContext {
    const nMine = myCards.length
    const nOpp = oppCards.length

    const oppIndicesLists: number[][] = Array.from({ length: slotCount }, () => [])
    // 相手の手のスロットペア→相手手インデックス(ペア重複検出用の一時Map)
    const oppPairMap = new Map<number, number>()
    for (let oi = 0; oi < nOpp; oi++) {
      const cs = oppCards[oi]
      for (const c of cs) oppIndicesLists[slotOf.get(c)!].push(oi)
      if (cs.length === 2) {
        const a = slotOf.get(cs[0])!
        const b = slotOf.get(cs[1])!
        oppPairMap.set(a < b ? a * slotCount + b : b * slotCount + a, oi)
      }
    }
    const oppIndicesBySlot = oppIndicesLists.map((list) => Int32Array.from(list))

    const myCardA = new Int32Array(nMine)
    const myCardB = new Int32Array(nMine)
    const pairOppIdx = new Int32Array(nMine)
    const needed = new Set<number>()
    for (let m = 0; m < nMine; m++) {
      const cs = myCards[m]
      myCardB[m] = -1
      pairOppIdx[m] = -1
      if (cs.length === 0) {
        myCardA[m] = -1
        continue
      }
      const a = slotOf.get(cs[0])!
      myCardA[m] = a
      needed.add(a)
      if (cs.length === 2) {
        const b = slotOf.get(cs[1])!
        myCardB[m] = b
        needed.add(b)
        const key = a < b ? a * slotCount + b : b * slotCount + a
        pairOppIdx[m] = oppPairMap.get(key) ?? -1
      }
    }

    return {
      nMine,
      nOpp,
      slotOf,
      myCardA,
      myCardB,
      pairOppIdx,
      oppIndicesBySlot,
      neededSlots: Int32Array.from(needed),
      slotReachScratch: new Float64Array(slotCount),
    }
  }
  return [buildOne(cards0, cards1), buildOne(cards1, cards0)]
}

/**
 * 片サイド分のスコア構造。ボードが決まればスコアは反復を通して不変なので、
 * 勝ち/引分の境界位置などをすべて構築時に事前計算しておく。
 * 呼び出しごとに変わるのは相手reachだけで、そのためのスクラッチバッファも保持する。
 */
export interface ScoreContext {
  /** このサイドの各手のスコア(元のインデックス順)。 */
  scores: Float64Array
  /** 相手側の各手のスコア(元のインデックス順)。 */
  oppScores: Float64Array
  /** 相手側の手インデックスをoppScoresの昇順で並べたもの。 */
  oppSortedIdx: Int32Array
  /** 手mの勝ち境界(自分より弱い相手の数)/勝ち+引分境界。ソート順位置。事前計算。 */
  loM: Int32Array
  hiM: Int32Array
  /** スロット→そのカードを含む相手コンボの、oppSortedIdx内での位置(昇順)。 */
  positionsBySlot: Int32Array[]
  /** 手mのカードA/Bについて、そのスロットのpositions内でのlo/hi境界位置。事前計算。 */
  cLoA: Int32Array
  cHiA: Int32Array
  cLoB: Int32Array
  cHiB: Int32Array
  /** pairOppIdx[m]>=0の場合の、相手ペアコンボスコアと自分スコアの比較(-1:相手弱, 0:同点, 1:相手強)。 */
  pairCmp: Int8Array
  /** 呼び出しごとのスクラッチ(シングルスレッド前提で再利用) */
  sortedReach: Float64Array
  prefixSum: Float64Array
  /** neededSlotsの各スロットに対応するreach加重prefix sum(長さ=positions.length+1)。 */
  slotPrefix: (Float64Array | undefined)[]
}

/** 両サイド分のScoreContextを構築する(ユニークなボードごとに1回、呼び出し側でキャッシュする)。 */
export function buildScoreContexts(
  scores0: Float64Array,
  scores1: Float64Array,
  blockCtx0: BlockingContext,
  blockCtx1: BlockingContext,
): [ScoreContext, ScoreContext] {
  function buildOne(myScores: Float64Array, oppScores: Float64Array, blockCtx: BlockingContext): ScoreContext {
    const nMine = myScores.length
    const nOpp = oppScores.length
    const oppSortedIdx = Int32Array.from({ length: nOpp }, (_, i) => i).sort((a, b) => oppScores[a] - oppScores[b])
    const positionOf = new Int32Array(nOpp)
    for (let pos = 0; pos < nOpp; pos++) positionOf[oppSortedIdx[pos]] = pos
    const sortedScores = new Float64Array(nOpp)
    for (let pos = 0; pos < nOpp; pos++) sortedScores[pos] = oppScores[oppSortedIdx[pos]]

    const slotCount = blockCtx.oppIndicesBySlot.length
    const positionsBySlot: Int32Array[] = new Array(slotCount)
    for (let s = 0; s < slotCount; s++) {
      positionsBySlot[s] = Int32Array.from(blockCtx.oppIndicesBySlot[s], (oi) => positionOf[oi]).sort((a, b) => a - b)
    }

    const loM = new Int32Array(nMine)
    const hiM = new Int32Array(nMine)
    const cLoA = new Int32Array(nMine)
    const cHiA = new Int32Array(nMine)
    const cLoB = new Int32Array(nMine)
    const cHiB = new Int32Array(nMine)
    const pairCmp = new Int8Array(nMine)
    for (let m = 0; m < nMine; m++) {
      const myScore = myScores[m]
      const lo = lowerBound(sortedScores, myScore)
      const hi = upperBound(sortedScores, myScore)
      loM[m] = lo
      hiM[m] = hi
      const a = blockCtx.myCardA[m]
      if (a >= 0) {
        const pa = positionsBySlot[a]
        cLoA[m] = lowerBoundInt(pa, lo)
        cHiA[m] = lowerBoundInt(pa, hi)
      }
      const b = blockCtx.myCardB[m]
      if (b >= 0) {
        const pb = positionsBySlot[b]
        cLoB[m] = lowerBoundInt(pb, lo)
        cHiB[m] = lowerBoundInt(pb, hi)
      }
      const p = blockCtx.pairOppIdx[m]
      if (p >= 0) {
        const s = oppScores[p]
        pairCmp[m] = s < myScore ? -1 : s === myScore ? 0 : 1
      }
    }

    const slotPrefix: (Float64Array | undefined)[] = new Array(slotCount)
    for (const s of blockCtx.neededSlots) slotPrefix[s] = new Float64Array(positionsBySlot[s].length + 1)

    return {
      scores: myScores,
      oppScores,
      oppSortedIdx,
      loM,
      hiM,
      positionsBySlot,
      cLoA,
      cHiA,
      cLoB,
      cHiB,
      pairCmp,
      sortedReach: new Float64Array(nOpp),
      prefixSum: new Float64Array(nOpp + 1),
      slotPrefix,
    }
  }
  return [buildOne(scores0, scores1, blockCtx0), buildOne(scores1, scores0, blockCtx1)]
}

/**
 * ショーダウンターミナルでの、このサイド各手の反実仮想値(生の合計、reach加重・
 * ブロッキング除外込み。1326コンボ全体でのcombo数正規化はしない)を計算する。
 * potBb: このターミナルの最終ポット。contributedMine: このサイドの追加投入額。
 *
 * ホットパス: 呼び出しごとに変わるのはoppReachのみ。reach加重prefix sum
 * (全体+自分の手に現れるカードスロット別)を構築時確保済みのスクラッチに再構築し、
 * あとは手ごとに事前計算済みの境界インデックスを引くだけのフラット配列演算。
 */
export function computeShowdownValue(
  scoreCtx: ScoreContext,
  blockCtx: BlockingContext,
  oppReach: Float64Array,
  potBb: number,
  contributedMine: number,
): Float64Array {
  const nMine = scoreCtx.scores.length
  const nOpp = scoreCtx.oppScores.length
  const { oppSortedIdx, sortedReach, prefixSum, positionsBySlot, slotPrefix } = scoreCtx

  for (let i = 0; i < nOpp; i++) sortedReach[i] = oppReach[oppSortedIdx[i]]
  for (let i = 0; i < nOpp; i++) prefixSum[i + 1] = prefixSum[i] + sortedReach[i]
  const totalReach = prefixSum[nOpp]

  for (let k = 0; k < blockCtx.neededSlots.length; k++) {
    const s = blockCtx.neededSlots[k]
    const positions = positionsBySlot[s]
    const prefix = slotPrefix[s]!
    for (let i = 0; i < positions.length; i++) prefix[i + 1] = prefix[i] + sortedReach[positions[i]]
  }

  const winPay = potBb - contributedMine
  const tiePay = potBb / 2 - contributedMine
  const losePay = -contributedMine
  const result = new Float64Array(nMine)
  for (let m = 0; m < nMine; m++) {
    const lo = scoreCtx.loM[m]
    const hi = scoreCtx.hiM[m]
    let winR = prefixSum[lo]
    let tieR = prefixSum[hi] - prefixSum[lo]
    let totalR = totalReach

    const a = blockCtx.myCardA[m]
    if (a >= 0) {
      const pa = slotPrefix[a]!
      totalR -= pa[pa.length - 1]
      winR -= pa[scoreCtx.cLoA[m]]
      tieR -= pa[scoreCtx.cHiA[m]] - pa[scoreCtx.cLoA[m]]
    }

    const b = blockCtx.myCardB[m]
    if (b >= 0) {
      const pb = slotPrefix[b]!
      totalR -= pb[pb.length - 1]
      winR -= pb[scoreCtx.cLoB[m]]
      tieR -= pb[scoreCtx.cHiB[m]] - pb[scoreCtx.cLoB[m]]
    }

    // 2枚とも重複する相手コンボ(高々1つ)は上で2回減算されているので1回分を戻す
    const p = blockCtx.pairOppIdx[m]
    if (p >= 0) {
      const r = oppReach[p]
      totalR += r
      const cmp = scoreCtx.pairCmp[m]
      if (cmp < 0) winR += r
      else if (cmp === 0) tieR += r
    }

    const loseR = totalR - winR - tieR
    result[m] = winR * winPay + tieR * tiePay + loseR * losePay
  }
  return result
}

/**
 * フォールドターミナルでの、このサイド各手の反実仮想値を計算する。スコア(役の
 * 強さ)を一切使わないため、ボード未確定のfoldターミナルでも安全に呼べる。
 * このサイドが勝つ(相手がfold)場合はnet=potBb-contributedMine、
 * 負ける(自分がfold)場合はnet=-contributedMineを、ブロッキング除外した
 * 相手reachの合計に掛ける。包除原理でO(手のカード枚数)の補正のみで求める。
 */
export function computeFoldValue(blockCtx: BlockingContext, oppReach: Float64Array, net: number): Float64Array {
  const { nMine, nOpp, myCardA, myCardB, pairOppIdx, oppIndicesBySlot, neededSlots, slotReachScratch } = blockCtx

  let totalReach = 0
  for (let i = 0; i < nOpp; i++) totalReach += oppReach[i]

  for (let k = 0; k < neededSlots.length; k++) {
    const s = neededSlots[k]
    const indices = oppIndicesBySlot[s]
    let sum = 0
    for (let i = 0; i < indices.length; i++) sum += oppReach[indices[i]]
    slotReachScratch[s] = sum
  }

  const result = new Float64Array(nMine)
  for (let m = 0; m < nMine; m++) {
    let totalR = totalReach
    const a = myCardA[m]
    if (a >= 0) totalR -= slotReachScratch[a]
    const b = myCardB[m]
    if (b >= 0) totalR -= slotReachScratch[b]
    const p = pairOppIdx[m]
    if (p >= 0) totalR += oppReach[p]
    result[m] = totalR * net
  }
  return result
}
