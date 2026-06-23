import { create } from 'zustand'
import { createGame, nextHand, applyAction, advanceStreet, computePayouts, isBettingClosed } from '../engine/game'
import { getBotAction } from '../bots/decision'
import type { GameState, Action, Card, Street } from '../engine/types'
import { calculateEquityExact } from '../analysis/equity'
import { requiredEquity } from '../analysis/potOdds'
import { getPostflopAdvice, estimatePlayerEquity } from '../advisor/postflop'
import { getPreflopAdvice, handString } from '../advisor/ranges'
import { getExploitAdjustment } from '../advisor/exploit'
import { buildExplanation, SIZE_RATIONALE } from '../advisor/explain'
import type { ExplainCode } from '../advisor/explain'
import { detectMistake } from '../advisor/mistakes'
import type { Mistake } from '../advisor/mistakes'
import { getYokosawaAdvice, getYokosawaContext, userHandStr } from '../advisor/yokosawa'
import type { YokosawaAdvice, YokosawaContext } from '../advisor/yokosawa'
import { saveSession, saveJudgePanelSettings, loadJudgePanelSettings } from './persistence'

export interface EquitySnapshot {
  exact: number | null            // 厳密エクイティ(答え)。null = プリフロップ
  estimate: number | null         // 実戦での読み(推奨の根拠)。null = プリフロップ
  required: number
  estimateMethod: 'draw' | 'made' | 'no_sdv' | 'air' | null  // 4-2 / 完成手 / 完成手だがSDVなし / ノーハンド
  estimateOuts: number            // draw時のアウツ数(made/preflopは0)
}

export interface Recommendation {
  action: string
  betSizeFraction?: number
  explanation: string
  explanationCode: ExplainCode
  sizeRationale?: string
  equity: EquitySnapshot
  alternatives: { action: string; reasoning: string }[]
  exploitNote?: string
  facingRaise?: boolean   // プリフロップで相手のレイズに直面しているか
  verdictText: string     // 推奨に連動した判定文(例: コールは割に合う)
  verdictTone: 'good' | 'bad' | 'neutral'
  gapWarning?: string     // 読みと実際がズレてコール/フォールドが変わる局面の警告
}

export interface EstimateResult {
  band: string
  trueEquity: number
  approxEquity: number | null
  correct: boolean
  adjacent: boolean
}

export interface HandRecord {
  handNumber: number
  street: Street
  board: Card[]
  userHoleCards: Card[]
  potTotal: number
  callAmount: number
  betLevel: number   // 決定時の currentBet (レイズ倍率の計算用)
  players: { name: string; type: string; holeCards: Card[] }[]
  actions: Action[]
  recommendation: Recommendation | null
  userAction: Action | null
  matched: boolean
  estimateResult: EstimateResult | null
  payout: Map<string, number>
  userNet?: number   // ハンド終了時に確定する、ユーザーのこのハンドの収支 (₱)
  mistake?: Mistake | null  // ミス判定結果 (ドンクベット等)
  yokosawaAdvice?: YokosawaAdvice | null
  yokosawaCtx?: YokosawaContext | null
}

export interface SessionStats {
  handsPlayed: number
  netBB: number
  vpip: number
  pfr: number
  matchRate: number
  estimateTotal: number
  estimateCorrect: number
  estimateAccuracy: number
  hintCount: number
}

export type AppView = 'table' | 'history' | 'study' | 'stats' | 'quiz'
export type BotSpeed = 'fast' | 'normal' | 'slow'
export type TableSize = 6 | 7 | 8

// 判定パネルの補助セクション(主要3要素=推奨アクション/数値ブロック/判定バナーは常時固定で対象外)
export interface JudgePanelSettings {
  rangeVsRange: boolean   // レンジ対レンジ勝率カード
  yokosawa: boolean       // ヨコサワモデルカード
  sizeJudge: boolean      // サイズ判定
  mistake: boolean        // ミス警告バナー
  gapWarning: boolean     // ギャップ警告
  explanation: boolean    // 解説テキスト
  alternatives: boolean   // 他の選択肢
  handLog: boolean        // このハンドの判断履歴
}

const DEFAULT_JUDGE_PANEL_SETTINGS: JudgePanelSettings = {
  rangeVsRange: true,
  yokosawa: true,
  sizeJudge: true,
  mistake: true,
  gapWarning: true,
  explanation: true,
  alternatives: true,
  handLog: true,
}

const BOT_DELAYS: Record<BotSpeed, number> = { fast: 250, normal: 600, slow: 1100 }

export interface AppState {
  game: GameState | null
  recommendation: Recommendation | null
  showRecommendation: boolean
  estimateMode: boolean
  estimatePending: boolean
  pendingAction: Action | null
  lastEstimate: EstimateResult | null
  handHistory: HandRecord[]
  sessionStats: SessionStats
  view: AppView
  hintCount: number
  showBotTypes: boolean
  botSpeed: BotSpeed
  tableSize: TableSize
  continuousPlay: boolean
  lastPayouts: Map<string, number>
  judgePanelSettings: JudgePanelSettings

  startNewGame: () => void
  resetSession: () => void
  submitAction: (action: Action) => void
  requestHint: () => void
  submitEstimate: (band: string) => void
  confirmEstimate: () => void
  advanceGame: () => void
  setView: (view: AppView) => void
  setBotSpeed: (speed: BotSpeed) => void
  setTableSize: (size: TableSize) => void
  toggleContinuousPlay: () => void
  toggleEstimateMode: () => void
  toggleShowBotTypes: () => void
  toggleJudgePanelSetting: (key: keyof JudgePanelSettings) => void
  exportHistory: (handNumbers?: number[]) => string
  importHistory: (json: string) => void
}

// 見積もりバンド定義 (EstimateModalと共有)
export const ESTIMATE_BANDS = [
  { label: '〜20%', min: 0, max: 0.20 },
  { label: '20-30%', min: 0.20, max: 0.30 },
  { label: '30-40%', min: 0.30, max: 0.40 },
  { label: '40-50%', min: 0.40, max: 0.50 },
  { label: '50%+', min: 0.50, max: 1.01 },
]

function bandIndexOf(equity: number): number {
  return ESTIMATE_BANDS.findIndex(b => equity >= b.min && equity < b.max)
}

// 解説のhandClass(役名ラベル)用
const STRENGTH_LABEL: Record<string, string> = {
  MONSTER: 'モンスター級の手',
  STRONG_MADE: '強い完成手',
  MIDDLE: 'トップペア級の手',
  WEAK_PAIR: '弱いペア',
  STRONG_DRAW: '強いドロー',
  WEAK_DRAW: '弱いドロー',
  AIR: 'ノーハンド',
}

function buildRecommendation(game: GameState): Recommendation | null {
  const user = game.players.find(p => p.isUser)
  if (!user || user.folded) return null

  const isPreflop = game.street === 'PREFLOP_BETTING'
  const BIG_BLIND = 50
  // Preflop: only "facing a raise" if someone raised above the big blind
  const facingBet = isPreflop ? game.currentBet > BIG_BLIND : game.currentBet > 0
  const callAmount = Math.max(0, game.currentBet - user.bet)
  const potTotal = game.pots.reduce((s, p) => s + p.amount, 0)
  const req = requiredEquity(callAmount, potTotal)

  const activeOpponents = game.players.filter(p => !p.isUser && !p.folded)

  let exactEq: number | null = null      // 厳密エクイティ(答え)
  let estEq: number | null = null        // 実戦での読み(推奨の根拠)
  let estMethod: 'draw' | 'made' | 'no_sdv' | 'air' | null = null
  let estOuts = 0
  let handClass: string | undefined      // バリュー解説用の役名ラベル

  if (!isPreflop && user.holeCards.length === 2 && game.board.length >= 3) {
    const knownVillains = activeOpponents
      .filter(p => p.holeCards.length === 2)
      .map(p => p.holeCards)
    exactEq = calculateEquityExact(user.holeCards, knownVillains, game.board).equity
    const est = estimatePlayerEquity(user.holeCards, game.board)
    estEq = est.value
    estMethod = est.method
    estOuts = est.outs
    handClass = STRENGTH_LABEL[est.strength]
  }

  const [c1, c2] = user.holeCards
  const suited = c1.suit === c2.suit
  const userHand = handString(c1.rank, c2.rank, suited)

  let code: ExplainCode
  let action: string
  let betSizeFraction: number | undefined
  const alternatives: { action: string; reasoning: string }[] = []

  if (isPreflop) {
    const advice = getPreflopAdvice(user.position, c1.rank, c2.rank, suited, facingBet)
    action = advice
    const isBBLimped = user.position === 'BB' && !facingBet
    code = advice === 'open' ? (isBBLimped ? 'BB_ISO_RAISE' : 'RANGE_OPEN_PRE')
         : advice === '3bet' ? 'RANGE_3BET_PRE'
         : advice === 'call' ? 'BB_DEFEND_CALL'
         : advice === 'check' ? 'BB_CHECK_OPTION'
         : facingBet ? 'RANGE_FOLD_VS_RAISE'
         : 'RANGE_FOLD_PRE'
  } else {
    const canCheck = game.currentBet === user.bet
    // 実戦ベース: 推奨は「あなたの読み(estEq)」で決める。厳密値は答え合わせ用。
    const advice = getPostflopAdvice(
      user.holeCards, game.board, estEq ?? 0.5, req, facingBet, canCheck, activeOpponents
    )
    action = advice.recommended.action
    betSizeFraction = advice.recommended.betSizeFraction
    code = advice.recommended.reason as ExplainCode
    alternatives.push(...advice.alternativeActions)
  }

  const explanation = buildExplanation(code, {
    equity: estEq ?? undefined,
    approxEquity: estEq ?? undefined,
    exactEquity: exactEq ?? undefined,
    requiredEquity: req,
    position: user.position,
    hand: userHand,
    handClass,
  })

  // 判定文(推奨アクションに連動)
  const pp = (v: number) => `${Math.round(v * 100)}%`
  let verdictText: string
  let verdictTone: 'good' | 'bad' | 'neutral'
  if (isPreflop) {
    verdictText = action === 'check' ? 'コール額0。チェックして無料でフロップへ'
      : action === 'fold' ? 'レンジ外なのでフォールド'
      : 'レンジ表どおりに参加'
    verdictTone = action === 'fold' ? 'neutral' : 'good'
  } else if (facingBet) {
    if (action === 'fold') {
      verdictText = `コールは割に合わない(読み ${pp(estEq!)} ＜ 必要 ${pp(req)})`
      verdictTone = 'bad'
    } else if (action === 'raise') {
      verdictText = `読み ${pp(estEq!)} で十分。レイズで主導権+バリュー`
      verdictTone = 'good'
    } else {
      verdictText = `コールは割に合う(読み ${pp(estEq!)} ≧ 必要 ${pp(req)})`
      verdictTone = 'good'
    }
  } else {
    const isBluffBet = code === 'BLUFF_BET' || code === 'TURN_INTO_BLUFF'
    if (action === 'bet' && isBluffBet) {
      verdictText = 'ここはブラフでベットする場面(バリューではない)'
      verdictTone = 'good'
    } else if (action === 'bet') {
      verdictText = 'ここはバリューでベットする場面'
      verdictTone = 'good'
    } else if (code === 'GIVE_UP_CHECK') {
      verdictText = 'ショーダウンバリューなし。チェックで諦める'
      verdictTone = 'neutral'
    } else {
      verdictText = 'チェックで様子見(コール不要)'
      verdictTone = 'neutral'
    }
  }

  // 読みと実際がズレて、コール/フォールドの結論が変わる局面の警告
  let gapWarning: string | undefined
  if (!isPreflop && facingBet && estEq != null && exactEq != null) {
    const estCall = estEq >= req
    const trueCall = exactEq >= req
    if (estCall && !trueCall) {
      gapWarning = `あなたの読み ${pp(estEq)} では割に合うように見えますが、実際の勝率は ${pp(exactEq)} で必要勝率 ${pp(req)} を下回ります。アウツを数えすぎ(相手も強くなるダーティアウツ)の可能性。実戦ではこういうミスが起きやすい局面です。`
    } else if (!estCall && trueCall) {
      gapWarning = `あなたの読み ${pp(estEq)} では降り推奨ですが、実際の勝率は ${pp(exactEq)} あり、本当はコールが得。見落としているアウツがないか確認しましょう。`
    }
  }

  // Exploit note from first active opponent
  let exploitNote: string | undefined
  if (activeOpponents.length > 0) {
    const adj = getExploitAdjustment(activeOpponents[0].type)
    if (adj) exploitNote = `調整: この相手は${adj.type}型。${adj.adjustment}`
  }

  return {
    action,
    betSizeFraction,
    explanation: explanation.text,
    explanationCode: code,
    sizeRationale: SIZE_RATIONALE[code],
    equity: { exact: exactEq, estimate: estEq, required: req, estimateMethod: estMethod, estimateOuts: estOuts },
    alternatives,
    exploitNote,
    facingRaise: isPreflop ? facingBet : undefined,
    verdictText,
    verdictTone,
    gapWarning,
  }
}

function initialStats(): SessionStats {
  return {
    handsPlayed: 0, netBB: 0, vpip: 0, pfr: 0, matchRate: 0,
    estimateTotal: 0, estimateCorrect: 0, estimateAccuracy: 0, hintCount: 0,
  }
}

// 推奨アクション(open/3bet等)と実際のActionTypeの一致判定
function actionMatches(actionType: string, recommended: string): boolean {
  const normalize = (a: string) =>
    a === 'open' || a === '3bet' ? 'raise'
    : a === 'allin' ? 'raise'
    : a
  return normalize(actionType) === normalize(recommended)
}

// Pending game-progress timer (bot action pacing). Module-level so a new
// hand or action can cancel a stale scheduled step.
let pendingTimer: ReturnType<typeof setTimeout> | null = null

// デバッグ用 (開発時のみ): ブラウザコンソールから状態を確認できるようにする
declare global {
  interface Window { __pokerStore?: unknown }
}

export const useAppStore = create<AppState>((set, get) => ({
  game: null,
  recommendation: null,
  showRecommendation: false,
  estimateMode: false,
  estimatePending: false,
  pendingAction: null,
  lastEstimate: null,
  handHistory: [],
  sessionStats: initialStats(),
  view: 'table',
  hintCount: 0,
  showBotTypes: false,
  botSpeed: 'normal',
  tableSize: 6,
  continuousPlay: true,
  lastPayouts: new Map(),
  judgePanelSettings: loadJudgePanelSettings() ?? DEFAULT_JUDGE_PANEL_SETTINGS,

  startNewGame: () => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    const prev = get().game
    const tblSize = get().tableSize
    // 連続プレイ: ボタンを回し、スタックを引き継ぐ。OFFなら毎回リセット
    const game = prev && get().continuousPlay
      ? nextHand(prev, 0)
      : { ...createGame(tblSize, 0), handNumber: (prev?.handNumber ?? 0) + 1 }
    set({
      game,
      recommendation: null,
      showRecommendation: false,
      estimatePending: false,
      pendingAction: null,
      lastEstimate: null,
      lastPayouts: new Map(),
    })
    get().advanceGame()
  },

  resetSession: () => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    set({
      game: createGame(get().tableSize, 0),
      recommendation: null,
      showRecommendation: false,
      estimatePending: false,
      pendingAction: null,
      lastEstimate: null,
      lastPayouts: new Map(),
    })
    get().advanceGame()
  },

  advanceGame: () => {
    // Cancel any pending step, then start stepping
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }

    const botDelay = BOT_DELAYS[get().botSpeed]
    const streetDelay = Math.round(botDelay * 0.8)

    const step = () => {
      pendingTimer = null
      const g = get().game
      if (!g) return

      // Payout: settle chips and mark hand over
      if (g.street === 'PAYOUT') {
        const payouts = computePayouts(g)
        const updatedPlayers = g.players.map(p => ({
          ...p,
          stack: p.stack + (payouts.get(p.id) ?? 0),
        }))
        const settled = { ...g, players: updatedPlayers, handOver: true }
        // Back-fill payout + user net into all hand records for this hand number
        const userPlayer = g.players.find(p => p.isUser)
        const userNet = (payouts.get(userPlayer?.id ?? '') ?? 0) - (userPlayer?.totalBetInHand ?? 0)
        const updatedHistory = get().handHistory.map(r =>
          r.handNumber === g.handNumber ? { ...r, payout: payouts, userNet } : r
        )
        set({ game: settled, lastPayouts: payouts, handHistory: updatedHistory })
        saveSession({ handHistory: updatedHistory, sessionStats: get().sessionStats })
        return
      }

      // Transit streets (FLOP, TURN, RIVER) and SHOWDOWN: deal and pause so cards are visible
      if (['SHOWDOWN', 'FLOP', 'TURN', 'RIVER'].includes(g.street)) {
        set({ game: advanceStreet(g) })
        pendingTimer = setTimeout(step, streetDelay)
        return
      }

      // Betting round over → advance street (with pause for the board card reveal)
      if (isBettingClosed(g)) {
        set({ game: advanceStreet(g) })
        pendingTimer = setTimeout(step, streetDelay)
        return
      }

      const actor = g.players[g.actionIndex]
      if (!actor || actor.folded || actor.allin) {
        set({ game: advanceStreet(g) })
        pendingTimer = setTimeout(step, streetDelay)
        return
      }

      // User's turn — stop and wait for decision (hide recommendation for active recall)
      if (actor.isUser) {
        const rec = buildRecommendation(g)
        set({ game: g, recommendation: rec, showRecommendation: false })
        return
      }

      // Bot acts — show it, then continue after a beat
      const action = getBotAction(g, actor)
      set({ game: applyAction(g, action) })
      pendingTimer = setTimeout(step, botDelay)
    }

    step()
  },

  submitAction: (action: Action) => {
    const { game, estimateMode, estimatePending, pendingAction, recommendation } = get()
    if (!game) return
    const user = game.players.find(p => p.isUser)
    if (!user) return

    // 見積もりモード: ベットに直面 (postflop, エクイティ計算済み) ならまずクイズ
    const callAmount = Math.max(0, game.currentBet - user.bet)
    const quizable = estimateMode
      && callAmount > 0
      && game.board.length >= 3
      && recommendation?.equity.exact != null
    if (quizable && !estimatePending && !pendingAction) {
      set({ estimatePending: true, pendingAction: action })
      return
    }

    executeUserAction(action, null)
  },

  submitEstimate: (band: string) => {
    const { recommendation, sessionStats } = get()
    const trueEquity = recommendation?.equity.exact
    if (trueEquity == null) {
      // 採点不能 (異常系): そのままアクション実行へ
      const pending = get().pendingAction
      set({ estimatePending: false, pendingAction: null, lastEstimate: null })
      if (pending) executeUserAction(pending, null)
      return
    }
    const trueIdx = bandIndexOf(trueEquity)
    const pickedIdx = ESTIMATE_BANDS.findIndex(b => b.label === band)
    const correct = trueIdx === pickedIdx
    const adjacent = Math.abs(trueIdx - pickedIdx) === 1
    const result: EstimateResult = {
      band,
      trueEquity,
      approxEquity: recommendation?.equity.estimate ?? null,
      correct,
      adjacent,
    }
    const total = sessionStats.estimateTotal + 1
    const correctCount = sessionStats.estimateCorrect + (correct ? 1 : 0)
    set({
      estimatePending: false,
      lastEstimate: result,
      sessionStats: {
        ...sessionStats,
        estimateTotal: total,
        estimateCorrect: correctCount,
        estimateAccuracy: correctCount / total,
      },
    })
    // モーダルは結果表示に切り替わり、confirmEstimate でアクション実行
  },

  confirmEstimate: () => {
    const { pendingAction, lastEstimate } = get()
    set({ pendingAction: null, lastEstimate: null })
    if (pendingAction) executeUserAction(pendingAction, lastEstimate)
  },

  requestHint: () => {
    const { game, hintCount } = get()
    if (!game) return
    const rec = buildRecommendation(game)
    set({ recommendation: rec, showRecommendation: true, hintCount: hintCount + 1 })
  },

  setView: (view: AppView) => set({ view }),
  setBotSpeed: (speed: BotSpeed) => set({ botSpeed: speed }),
  setTableSize: (size) => set({ tableSize: size }),
  toggleContinuousPlay: () => set(s => ({ continuousPlay: !s.continuousPlay })),
  toggleEstimateMode: () => set(s => ({ estimateMode: !s.estimateMode })),
  toggleShowBotTypes: () => set(s => ({ showBotTypes: !s.showBotTypes })),
  toggleJudgePanelSetting: (key) => {
    const next = { ...get().judgePanelSettings, [key]: !get().judgePanelSettings[key] }
    saveJudgePanelSettings(next)
    set({ judgePanelSettings: next })
  },

  exportHistory: (handNumbers?: number[]) => {
    const { handHistory, sessionStats } = get()
    const filter = handNumbers ? new Set(handNumbers) : null
    const records = filter ? handHistory.filter(r => filter.has(r.handNumber)) : handHistory
    return JSON.stringify({ handHistory: records.map(r => ({
      ...r,
      payout: [...r.payout.entries()],
    })), sessionStats }, null, 2)
  },

  importHistory: (json: string) => {
    try {
      const data = JSON.parse(json)
      const handHistory = (data.handHistory ?? []).map((r: HandRecord & { payout: [string, number][] }) => ({
        ...r,
        payout: new Map(r.payout),
      }))
      set({ handHistory, sessionStats: data.sessionStats ?? initialStats() })
    } catch {
      console.error('Import failed: invalid JSON')
    }
  },
}))

// ユーザーアクションの実行 (記録 + 適用 + ボット進行)。
// submitAction と confirmEstimate (見積もりモード) の共通処理
function executeUserAction(action: Action, estimateResult: EstimateResult | null) {
  const store = useAppStore.getState()
  const { game, recommendation, handHistory, sessionStats } = store
  if (!game) return
  const user = game.players.find(p => p.isUser)
  if (!user) return

  const potTotal = game.pots.reduce((s, p) => s + p.amount, 0)
  const callAmount = Math.max(0, game.currentBet - user.bet)

  const newGame = applyAction(game, action)
  const matched = recommendation ? actionMatches(action.type, recommendation.action) : true

  const equity = recommendation
    ? { estimate: recommendation.equity.estimate, required: recommendation.equity.required }
    : null
  const mistake = detectMistake(game, action, equity)

  // プリフロップのみヨコサワモデルを記録
  const isPreflop = game.street === 'PREFLOP_BETTING'
  const yokoHand = isPreflop ? userHandStr(user) : null
  const yokosawaCtx = isPreflop ? getYokosawaContext(game, user) : null
  const yokosawaAdvice = isPreflop && yokoHand && yokosawaCtx
    ? getYokosawaAdvice({
        position: user.position,
        handStr: yokoHand,
        facingRaise: yokosawaCtx.facingRaise,
        raiserPosition: yokosawaCtx.raiserPosition,
        raiseCount: yokosawaCtx.raiseCount,
        tableSize: yokosawaCtx.tableSize,
      })
    : null

  const record: HandRecord = {
    handNumber: game.handNumber,
    street: game.street,
    board: game.board,
    userHoleCards: user.holeCards,
    potTotal,
    callAmount,
    betLevel: game.currentBet,
    players: game.players.map(p => ({
      name: p.name,
      type: p.type,
      holeCards: p.holeCards,
    })),
    actions: [...game.actionHistory, action],
    recommendation,
    userAction: action,
    matched,
    estimateResult,
    payout: new Map(),
    mistake,
    yokosawaAdvice,
    yokosawaCtx,
  }

  const newHistory = [...handHistory, record]
  const stats: SessionStats = {
    ...sessionStats,
    matchRate: newHistory.length > 0
      ? newHistory.filter(r => r.matched).length / newHistory.length
      : 0,
    hintCount: store.hintCount,
  }

  useAppStore.setState({
    game: newGame,
    showRecommendation: true,
    handHistory: newHistory,
    sessionStats: stats,
    estimatePending: false,
  })

  // advance bots (short pause so the user's own action badge is visible first)
  setTimeout(() => useAppStore.getState().advanceGame(), 400)
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__pokerStore = useAppStore
}
