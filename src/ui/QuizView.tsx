import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { CardView } from './CardView'
import { YokosawaRangeGrid } from './YokosawaRangeGrid'
import { RangeSetGrid } from './RangeSetGrid'
import { MiniTableDiagram } from './MiniTableDiagram'
import { POSITION_INFO } from './glossary'
import { CheckIcon, CrossIcon } from './icons'
import { TIER_INFO, TIER_ORDER, YOKOSAWA_ACTION_JA } from '../advisor/yokosawa'
import type { YokosawaTier, YokosawaAction } from '../advisor/yokosawa'
import {
  makePreflopQuestion, makeTierQuestion, makeReraiseQuestion, makeRangePredictionQuestion,
} from '../advisor/quiz'
import type {
  PreflopQuestion, TierQuestion, ReraiseQuestion, PreflopAnswer, RandomHand,
  RangePredictionQuestion, RangePredictionAction, RangeStreet,
} from '../advisor/quiz'

type QuizMode = 'preflop' | 'tier' | 'reraise' | 'range'

const MODE_LABELS: Record<QuizMode, string> = {
  preflop: '① プリフロップ判定',
  tier: '② ヨコサワ色当て',
  reraise: '③ リレイズ判定(実践)',
  range: '④ レンジ予想',
}

const MODE_DESC: Record<QuizMode, string> = {
  preflop: 'ポジションと手札を見て、ヨコサワモデルでフォールドかレイズかを判定。6〜8人テーブルが毎問ランダムに変わります。',
  tier: '手札を見て、その手がヨコサワモデルで何色のティアかを当てます。',
  reraise: '相手がレイズしてきた局面。ヨコサワモデルで相手の色を仮定し、リレイズ/コール/フォールドを判定します。',
  range: '相手のポジション・アクション(オープン/3ベット)とその後のフロップ/ターン/リバーでのベット・コールから、相手が実際に持っているレンジを候補の中から当てます。',
}

// 問題の同一性キー（wrong リストの重複防止・除外に使用）
function preflopKey(q: PreflopQuestion) { return `${q.position}|${q.hand.handStr}|${q.tableSize}` }
function tierKey(q: TierQuestion) { return q.hand.handStr }
function reraiseKey(q: ReraiseQuestion) { return `${q.position}|${q.raiserPosition}|${q.raiseCount}|${q.hand.handStr}|${q.tableSize}` }
function rangeKey(q: RangePredictionQuestion) {
  const boardSig = q.board.map(c => `${c.rank}${c.suit}`).join(',')
  return `${q.raiserPosition}|${q.preflopAction}|${q.tableSize}|${q.street}|${boardSig}|${q.postflopAction ?? ''}`
}

export function QuizView() {
  const [mode, setMode] = useState<QuizMode>('preflop')
  const [reviewMode, setReviewMode] = useState(false)
  const [wrongPreflop, setWrongPreflop] = useState<PreflopQuestion[]>([])
  const [wrongTier, setWrongTier] = useState<TierQuestion[]>([])
  const [wrongReraise, setWrongReraise] = useState<ReraiseQuestion[]>([])
  const [wrongRange, setWrongRange] = useState<RangePredictionQuestion[]>([])

  const wrongCount: Record<QuizMode, number> = {
    preflop: wrongPreflop.length,
    tier: wrongTier.length,
    reraise: wrongReraise.length,
    range: wrongRange.length,
  }
  const currentWrongCount = wrongCount[mode]

  function switchMode(m: QuizMode) { setMode(m); setReviewMode(false) }
  function toggleReviewMode() {
    if (!reviewMode && currentWrongCount === 0) return
    setReviewMode(r => !r)
  }

  function addWrongPreflop(q: PreflopQuestion) {
    setWrongPreflop(prev => prev.some(p => preflopKey(p) === preflopKey(q)) ? prev : [...prev, q])
  }
  function removeWrongPreflop(q: PreflopQuestion) {
    setWrongPreflop(prev => prev.filter(p => preflopKey(p) !== preflopKey(q)))
  }
  function addWrongTier(q: TierQuestion) {
    setWrongTier(prev => prev.some(p => tierKey(p) === tierKey(q)) ? prev : [...prev, q])
  }
  function removeWrongTier(q: TierQuestion) {
    setWrongTier(prev => prev.filter(p => tierKey(p) !== tierKey(q)))
  }
  function addWrongReraise(q: ReraiseQuestion) {
    setWrongReraise(prev => prev.some(p => reraiseKey(p) === reraiseKey(q)) ? prev : [...prev, q])
  }
  function removeWrongReraise(q: ReraiseQuestion) {
    setWrongReraise(prev => prev.filter(p => reraiseKey(p) !== reraiseKey(q)))
  }
  function addWrongRange(q: RangePredictionQuestion) {
    setWrongRange(prev => prev.some(p => rangeKey(p) === rangeKey(q)) ? prev : [...prev, q])
  }
  function removeWrongRange(q: RangePredictionQuestion) {
    setWrongRange(prev => prev.filter(p => rangeKey(p) !== rangeKey(q)))
  }

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ color: 'var(--gold)', fontSize: 18 }}>一問一答</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['preflop', 'tier', 'reraise', 'range'] as QuizMode[]).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                background: mode === m ? 'var(--green-mid)' : 'transparent',
                color: mode === m ? 'var(--gold-light)' : 'var(--text-muted)',
                padding: '6px 14px', fontSize: 13.5,
                fontWeight: mode === m ? 600 : 400,
                border: '1px solid ' + (mode === m ? 'var(--green-light)' : 'var(--panel-border)'),
                borderRadius: 6,
                position: 'relative',
              }}
            >
              {MODE_LABELS[m]}
              {wrongCount[m] > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -6,
                  background: 'var(--red)', color: '#fff',
                  borderRadius: 10, padding: '0 5px', fontSize: 10, lineHeight: '16px',
                  fontWeight: 700, minWidth: 16, textAlign: 'center',
                }}>
                  {wrongCount[m]}
                </span>
              )}
            </button>
          ))}
        </div>

        <button
          onClick={toggleReviewMode}
          style={{
            background: reviewMode ? 'rgba(217,64,64,0.2)' : 'transparent',
            color: reviewMode ? '#e07070' : currentWrongCount > 0 ? 'var(--text-muted)' : 'var(--text-dim)',
            border: '1px solid ' + (reviewMode ? '#e07070' : currentWrongCount > 0 ? 'rgba(217,64,64,0.5)' : 'var(--panel-border)'),
            borderRadius: 6,
            padding: '6px 14px', fontSize: 13, fontWeight: reviewMode ? 700 : 400,
            cursor: currentWrongCount === 0 && !reviewMode ? 'not-allowed' : 'pointer',
            opacity: currentWrongCount === 0 && !reviewMode ? 0.4 : 1,
          }}
        >
          {reviewMode ? '× 復習中' : `復習 (${currentWrongCount}問)`}
        </button>
      </div>

      {reviewMode ? (
        <p style={{ color: '#e07070', fontSize: 13, marginBottom: 16, lineHeight: 1.7 }}>
          復習モード — 間違えた <strong>{currentWrongCount}問</strong> を繰り返し練習中。正解すると除外されます。
        </p>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16, lineHeight: 1.7 }}>
          {MODE_DESC[mode]}
        </p>
      )}

      {mode === 'preflop' && (
        <PreflopQuiz
          reviewMode={reviewMode}
          wrongList={wrongPreflop}
          onWrong={addWrongPreflop}
          onCorrect={removeWrongPreflop}
        />
      )}
      {mode === 'tier' && (
        <TierQuiz
          reviewMode={reviewMode}
          wrongList={wrongTier}
          onWrong={addWrongTier}
          onCorrect={removeWrongTier}
        />
      )}
      {mode === 'reraise' && (
        <ReraiseQuiz
          reviewMode={reviewMode}
          wrongList={wrongReraise}
          onWrong={addWrongReraise}
          onCorrect={removeWrongReraise}
        />
      )}
      {mode === 'range' && (
        <RangePredictionQuiz
          reviewMode={reviewMode}
          wrongList={wrongRange}
          onWrong={addWrongRange}
          onCorrect={removeWrongRange}
        />
      )}
    </div>
  )
}

// ===== 復習完了表示 =====
function ReviewComplete() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        textAlign: 'center', padding: '48px 24px',
        background: 'rgba(58,153,96,0.1)',
        border: '1px solid var(--green-light)',
        borderRadius: 14,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green-light)', marginBottom: 8 }}>
        復習完了！
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        間違えた問題をすべてクリアしました。
      </div>
    </motion.div>
  )
}

// ===== 共通: スコア表示 =====
function ScoreBar({ correct, total, streak }: { correct: number; total: number; streak: number }) {
  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
      <span>正解: <strong style={{ color: 'var(--green-light)' }}>{correct}</strong> / {total}</span>
      {total > 0 && <span>正答率: <strong style={{ color: 'var(--gold-light)' }}>{Math.round((correct / total) * 100)}%</strong></span>}
      <span>連続正解: <strong style={{ color: 'var(--gold-light)' }}>{streak}</strong></span>
    </div>
  )
}

// 手札 2 枚
function HandCards({ hand, size = 'xl' }: { hand: RandomHand; size?: 'lg' | 'xl' }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {hand.cards.map((c, i) => <CardView key={i} card={c} size={size} />)}
    </div>
  )
}

// ポジションバッジ
function PositionBadge({ pos, label }: { pos: string; label?: string }) {
  const info = POSITION_INFO[pos as keyof typeof POSITION_INFO]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(200,168,75,0.15)', borderRadius: 6, padding: '4px 12px',
    }}>
      <strong style={{ color: 'var(--gold-light)', fontSize: 15 }}>{pos}</strong>
      <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{label ?? info?.nameJa}</span>
    </span>
  )
}

// 正誤バナー
function ResultBanner({ correct, correctLabel }: { correct: boolean; correctLabel: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: correct ? 'rgba(58,153,96,0.15)' : 'rgba(217,64,64,0.15)',
      border: `1px solid ${correct ? 'var(--green-light)' : 'var(--red)'}`,
      borderRadius: 10, padding: '10px 14px', fontSize: 15, fontWeight: 700,
      color: correct ? 'var(--green-light)' : 'var(--red)',
    }}>
      {correct ? <CheckIcon size={18} /> : <CrossIcon size={18} />}
      {correct ? '正解！' : `不正解 — 正解は「${correctLabel}」`}
    </div>
  )
}

function NextButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      style={{
        background: 'var(--green-mid)', color: 'var(--gold-light)',
        padding: '9px 24px', fontSize: 14.5, borderRadius: 8, fontWeight: 600,
      }}
    >
      次の問題 →
    </motion.button>
  )
}

const CHOICE_BTN = (active: boolean): React.CSSProperties => ({
  padding: '12px 22px', fontSize: 16, fontWeight: 700, borderRadius: 10,
  border: '1px solid var(--panel-border)',
  background: active ? 'var(--gold)' : 'var(--panel-bg-light)',
  color: active ? '#1a2a1a' : 'var(--text)',
  cursor: 'pointer', minWidth: 110,
})

// ============================================================
// モード①: ヨコサワフォールド/レイズ判定
// ============================================================
type PreflopQuizProps = {
  reviewMode: boolean
  wrongList: PreflopQuestion[]
  onWrong: (q: PreflopQuestion) => void
  onCorrect: (q: PreflopQuestion) => void
}

function PreflopQuiz({ reviewMode, wrongList, onWrong, onCorrect }: PreflopQuizProps) {
  const [q, setQ] = useState<PreflopQuestion>(() =>
    reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makePreflopQuestion()
  )
  const [answered, setAnswered] = useState<PreflopAnswer | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0 })
  const [reviewDone, setReviewDone] = useState(false)

  useEffect(() => {
    const nextQ = reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makePreflopQuestion()
    setQ(nextQ)
    setAnswered(null)
    setReviewDone(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode])

  if (reviewMode && reviewDone) return <ReviewComplete />

  function answer(a: PreflopAnswer) {
    if (answered) return
    const ok = a === q.correct
    setAnswered(a)
    setScore(s => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }))
    if (ok) onCorrect(q)
    else onWrong(q)
  }

  function next() {
    if (answered === null) return // 二度押し防止: 未回答状態からの遷移は弾く
    if (reviewMode) {
      if (wrongList.length === 0) { setReviewDone(true); return }
      // 同じ問題が連続しないよう他の候補を優先。1問しか残っていない場合は同じ問題を再出題
      const others = wrongList.filter(w => preflopKey(w) !== preflopKey(q))
      const pool = others.length > 0 ? others : wrongList
      setQ(pool[Math.floor(Math.random() * pool.length)])
    } else {
      setQ(makePreflopQuestion())
    }
    setAnswered(null)
  }

  const labelJa = (a: PreflopAnswer) => (a === 'raise' ? 'レイズ' : 'フォールド')

  return (
    <div>
      <ScoreBar {...score} />
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* 左: 問題 */}
        <div style={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <MiniTableDiagram tableSize={q.tableSize} heroPosition={q.position} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{q.tableSize}人テーブル</div>
              <PositionBadge pos={q.position} />
            </div>
          </div>
          <HandCards hand={q.hand} />
          {!answered ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <button style={CHOICE_BTN(false)} onClick={() => answer('fold')}>フォールド</button>
              <button style={CHOICE_BTN(false)} onClick={() => answer('raise')}>レイズ</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ResultBanner correct={answered === q.correct} correctLabel={labelJa(q.correct)} />
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                あなたの回答: <strong style={{ color: 'var(--text)' }}>{labelJa(answered)}</strong>
              </div>
              <NextButton onClick={next} />
            </div>
          )}
        </div>

        {/* 右: 学習パネル(ヨコサワレンジ表 + 根拠) */}
        {answered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{
              background: 'var(--panel-bg)', borderRadius: 10, padding: 12,
              border: '1px solid var(--panel-border)', fontSize: 13, lineHeight: 1.7, color: 'var(--text)',
            }}>
              {q.reasoning}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#9fb0e8', marginBottom: 6 }}>
                ヨコサワモデル(色 = 役の強さ)
              </div>
              <YokosawaRangeGrid highlightHand={q.hand.handStr} cellSize={24} />
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// モード②: ヨコサワ色当て
// ============================================================
type TierQuizProps = {
  reviewMode: boolean
  wrongList: TierQuestion[]
  onWrong: (q: TierQuestion) => void
  onCorrect: (q: TierQuestion) => void
}

function TierQuiz({ reviewMode, wrongList, onWrong, onCorrect }: TierQuizProps) {
  const [q, setQ] = useState<TierQuestion>(() =>
    reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeTierQuestion()
  )
  const [answered, setAnswered] = useState<YokosawaTier | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0 })
  const [reviewDone, setReviewDone] = useState(false)

  useEffect(() => {
    const nextQ = reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeTierQuestion()
    setQ(nextQ)
    setAnswered(null)
    setReviewDone(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode])

  if (reviewMode && reviewDone) return <ReviewComplete />

  function answer(t: YokosawaTier) {
    if (answered) return
    const ok = t === q.correct
    setAnswered(t)
    setScore(s => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }))
    if (ok) onCorrect(q)
    else onWrong(q)
  }

  function next() {
    if (answered === null) return // 二度押し防止: 未回答状態からの遷移は弾く
    if (reviewMode) {
      if (wrongList.length === 0) { setReviewDone(true); return }
      const others = wrongList.filter(w => tierKey(w) !== tierKey(q))
      const pool = others.length > 0 ? others : wrongList
      setQ(pool[Math.floor(Math.random() * pool.length)])
    } else {
      setQ(makeTierQuestion())
    }
    setAnswered(null)
  }

  return (
    <div>
      <ScoreBar {...score} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <HandCards hand={q.hand} />
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>この手はヨコサワモデルで何色？</div>

        {/* 7 色の選択肢 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 560 }}>
          {TIER_ORDER.map(t => {
            const info = TIER_INFO[t]
            const isCorrect = answered && t === q.correct
            const isWrongPick = answered === t && t !== q.correct
            return (
              <button
                key={t}
                onClick={() => answer(t)}
                style={{
                  background: info.color, color: info.textColor,
                  padding: '10px 16px', fontSize: 14, fontWeight: 700, borderRadius: 8,
                  border: isCorrect ? '3px solid var(--green-light)'
                    : isWrongPick ? '3px solid var(--red)'
                    : '1px solid rgba(0,0,0,0.3)',
                  cursor: answered ? 'default' : 'pointer',
                  opacity: answered && !isCorrect && !isWrongPick ? 0.5 : 1,
                  minWidth: 64,
                }}
              >
                {info.labelJa}
              </button>
            )
          })}
        </div>

        {answered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, width: '100%' }}
          >
            <ResultBanner correct={answered === q.correct} correctLabel={TIER_INFO[q.correct].labelJa} />
            <YokosawaRangeGrid highlightHand={q.hand.handStr} cellSize={26} />
            <NextButton onClick={next} />
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// モード③: リレイズ判定(実践形式)
// ============================================================
const RERAISE_CHOICES: YokosawaAction[] = ['reraise', 'call', 'fold']

type ReraiseQuizProps = {
  reviewMode: boolean
  wrongList: ReraiseQuestion[]
  onWrong: (q: ReraiseQuestion) => void
  onCorrect: (q: ReraiseQuestion) => void
}

function ReraiseQuiz({ reviewMode, wrongList, onWrong, onCorrect }: ReraiseQuizProps) {
  const [q, setQ] = useState<ReraiseQuestion>(() =>
    reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeReraiseQuestion()
  )
  const [answered, setAnswered] = useState<YokosawaAction | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0 })
  const [reviewDone, setReviewDone] = useState(false)

  useEffect(() => {
    const nextQ = reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeReraiseQuestion()
    setQ(nextQ)
    setAnswered(null)
    setReviewDone(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode])

  if (reviewMode && reviewDone) return <ReviewComplete />

  function answer(a: YokosawaAction) {
    if (answered) return
    const ok = a === q.correct
    setAnswered(a)
    setScore(s => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }))
    if (ok) onCorrect(q)
    else onWrong(q)
  }

  function next() {
    if (answered === null) return // 二度押し防止: 未回答状態からの遷移は弾く
    if (reviewMode) {
      if (wrongList.length === 0) { setReviewDone(true); return }
      const others = wrongList.filter(w => reraiseKey(w) !== reraiseKey(q))
      const pool = others.length > 0 ? others : wrongList
      setQ(pool[Math.floor(Math.random() * pool.length)])
    } else {
      setQ(makeReraiseQuestion())
    }
    setAnswered(null)
  }

  return (
    <div>
      <ScoreBar {...score} />
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* 左: 問題 */}
        <div style={{ flex: '0 0 340px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* テーブル図 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <MiniTableDiagram tableSize={q.tableSize} heroPosition={q.position} raiserPosition={q.raiserPosition} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{q.tableSize}人テーブル</div>
              <PositionBadge pos={q.position} />
            </div>
          </div>
          {/* シナリオバッジ */}
          <div style={{
            background: 'rgba(217,64,64,0.12)', border: '1px solid rgba(217,64,64,0.4)',
            borderRadius: 8, padding: '8px 12px', fontSize: 14, color: 'var(--text)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <strong style={{ color: 'var(--gold-light)' }}>{q.raiserPosition}</strong>
            が{q.raiseCount >= 2 ? '3ベット(再レイズ)' : 'オープンレイズ'}してきました
          </div>
          <HandCards hand={q.hand} />
          {!answered ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {RERAISE_CHOICES.map(a => (
                <button key={a} style={CHOICE_BTN(false)} onClick={() => answer(a)}>
                  {a === 'reraise' ? 'リレイズ' : a === 'call' ? 'コール' : 'フォールド'}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ResultBanner correct={answered === q.correct} correctLabel={YOKOSAWA_ACTION_JA[q.correct]} />
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                あなたの回答: <strong style={{ color: 'var(--text)' }}>{YOKOSAWA_ACTION_JA[answered]}</strong>
              </div>
              <NextButton onClick={next} />
            </div>
          )}
        </div>

        {/* 右: 解説 */}
        {answered && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{
              background: 'var(--panel-bg)', borderRadius: 10, padding: 13,
              border: '1px solid var(--panel-border)', fontSize: 13.5, lineHeight: 1.7, color: 'var(--text)',
            }}>
              {q.reasoning}
            </div>
            <YokosawaRangeGrid highlightHand={q.hand.handStr} cellSize={24} />
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// モード④: 相手レンジ予想 (候補レンジから選択)
// ============================================================
type RangeQuizProps = {
  reviewMode: boolean
  wrongList: RangePredictionQuestion[]
  onWrong: (q: RangePredictionQuestion) => void
  onCorrect: (q: RangePredictionQuestion) => void
}

type TableSizeSetting = 'random' | 6 | 7 | 8
type ActionSetting = 'both' | RangePredictionAction
type StreetSetting = 'random' | RangeStreet

const STREET_SETTING_JA: Record<StreetSetting, string> = {
  random: 'ランダム',
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
}

function buildRangeQuestionOpts(tableSizeSetting: TableSizeSetting, actionSetting: ActionSetting, streetSetting: StreetSetting) {
  return {
    tableSize: tableSizeSetting === 'random' ? undefined : tableSizeSetting,
    preflopActions: actionSetting === 'both' ? undefined : [actionSetting],
    streets: streetSetting === 'random' ? undefined : [streetSetting],
  }
}

function RangePredictionQuiz({ reviewMode, wrongList, onWrong, onCorrect }: RangeQuizProps) {
  const [tableSizeSetting, setTableSizeSetting] = useState<TableSizeSetting>('random')
  const [actionSetting, setActionSetting] = useState<ActionSetting>('both')
  const [streetSetting, setStreetSetting] = useState<StreetSetting>('random')

  const [q, setQ] = useState<RangePredictionQuestion>(() =>
    reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeRangePredictionQuestion(buildRangeQuestionOpts(tableSizeSetting, actionSetting, streetSetting))
  )
  const [answered, setAnswered] = useState<number | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0 })
  const [reviewDone, setReviewDone] = useState(false)

  useEffect(() => {
    const nextQ = reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeRangePredictionQuestion(buildRangeQuestionOpts(tableSizeSetting, actionSetting, streetSetting))
    setQ(nextQ)
    setAnswered(null)
    setReviewDone(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewMode])

  if (reviewMode && reviewDone) return <ReviewComplete />

  function answer(idx: number) {
    if (answered !== null) return
    const ok = idx === q.correctIndex
    setAnswered(idx)
    setScore(s => ({ correct: s.correct + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }))
    if (ok) onCorrect(q)
    else onWrong(q)
  }

  function next() {
    if (answered === null) return // 二度押し防止: 未回答状態からの遷移は弾く
    if (reviewMode) {
      if (wrongList.length === 0) { setReviewDone(true); return }
      const others = wrongList.filter(w => rangeKey(w) !== rangeKey(q))
      const pool = others.length > 0 ? others : wrongList
      setQ(pool[Math.floor(Math.random() * pool.length)])
    } else {
      setQ(makeRangePredictionQuestion(buildRangeQuestionOpts(tableSizeSetting, actionSetting, streetSetting)))
    }
    setAnswered(null)
  }

  return (
    <div>
      <ScoreBar {...score} />

      {/* 調整パネル */}
      {!reviewMode && (
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14, fontSize: 12.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim)' }}>人数:</span>
            {(['random', 6, 7, 8] as TableSizeSetting[]).map(v => (
              <button
                key={String(v)}
                onClick={() => setTableSizeSetting(v)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12,
                  background: tableSizeSetting === v ? 'var(--green-mid)' : 'transparent',
                  color: tableSizeSetting === v ? 'var(--gold-light)' : 'var(--text-muted)',
                  border: '1px solid ' + (tableSizeSetting === v ? 'var(--green-light)' : 'var(--panel-border)'),
                }}
              >
                {v === 'random' ? 'ランダム' : `${v}人`}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim)' }}>アクション:</span>
            {([['both', '両方'], ['open', 'オープンのみ'], ['3bet', '3betのみ']] as [ActionSetting, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setActionSetting(v)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12,
                  background: actionSetting === v ? 'var(--green-mid)' : 'transparent',
                  color: actionSetting === v ? 'var(--gold-light)' : 'var(--text-muted)',
                  border: '1px solid ' + (actionSetting === v ? 'var(--green-light)' : 'var(--panel-border)'),
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim)' }}>ストリート:</span>
            {(['random', 'preflop', 'flop', 'turn', 'river'] as StreetSetting[]).map(v => (
              <button
                key={v}
                onClick={() => setStreetSetting(v)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 12,
                  background: streetSetting === v ? 'var(--green-mid)' : 'transparent',
                  color: streetSetting === v ? 'var(--gold-light)' : 'var(--text-muted)',
                  border: '1px solid ' + (streetSetting === v ? 'var(--green-light)' : 'var(--panel-border)'),
                }}
              >
                {STREET_SETTING_JA[v]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {/* 左: シナリオ */}
        <div style={{ flex: '0 0 240px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MiniTableDiagram tableSize={q.tableSize} raiserPosition={q.raiserPosition} />
          {q.board.length > 0 && (
            <div style={{ display: 'flex', gap: 4 }}>
              {q.board.map((c, i) => <CardView key={i} card={c} size="lg" />)}
            </div>
          )}
          <div style={{
            background: 'rgba(217,64,64,0.12)', border: '1px solid rgba(217,64,64,0.4)',
            borderRadius: 8, padding: '8px 12px', fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6,
          }}>
            {q.scenarioJa}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            このとき、<strong style={{ color: 'var(--gold-light)' }}>{q.raiserPosition}</strong>が実際に持っているレンジは、右の候補のうちどれ？
          </div>
        </div>

        {/* 右: 候補グリッド */}
        <div style={{ flex: 1, minWidth: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {q.candidates.map((c, i) => {
              const isCorrect = answered !== null && i === q.correctIndex
              const isWrongPick = answered === i && i !== q.correctIndex
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                  <button
                    onClick={() => answer(i)}
                    disabled={answered !== null}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      background: 'transparent', padding: 6, borderRadius: 8,
                      border: isCorrect ? '2px solid var(--green-light)'
                        : isWrongPick ? '2px solid var(--red)'
                        : '1px solid var(--panel-border)',
                      cursor: answered !== null ? 'default' : 'pointer',
                      opacity: answered !== null && !isCorrect && !isWrongPick ? 0.5 : 1,
                    }}
                  >
                    <RangeSetGrid hands={new Set(c.hands)} cellSize={14} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>候補{i + 1}</span>
                  </button>
                  {answered !== null && (
                    <span style={{ fontSize: 11, color: isCorrect ? 'var(--green-light)' : 'var(--text-dim)', textAlign: 'center', maxWidth: 200 }}>
                      {c.labelJa}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {answered !== null && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <ResultBanner
                correct={answered === q.correctIndex}
                correctLabel={`候補${q.correctIndex + 1} (${q.candidates[q.correctIndex].labelJa})`}
              />
              <div style={{
                background: 'var(--panel-bg)', borderRadius: 10, padding: 12,
                border: '1px solid var(--panel-border)', fontSize: 13, lineHeight: 1.7, color: 'var(--text)',
              }}>
                {q.reasoning}
              </div>
              <NextButton onClick={next} />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
