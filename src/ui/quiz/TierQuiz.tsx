import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { CardView } from '../CardView'
import { YokosawaRangeGrid } from '../YokosawaRangeGrid'
import { CheckIcon, CrossIcon } from '../icons'
import { TIER_INFO, TIER_DISPLAY_ORDER } from '../../advisor/yokosawa'
import type { YokosawaTier } from '../../advisor/yokosawa'
import { makeTierQuestion } from '../../advisor/quiz'
import type { TierQuestion, RandomHand } from '../../advisor/quiz'

// P12 Phase A-2: QuizView.tsx(旧アプリ「一問一答」)にあった「②ヨコサワ色当て」モードを、
// 新GTOアプリの「学習」タブからも同じ実装で使えるよう共有モジュールへ抽出した。
// 挙動・見た目は移設元から不変(ロジック自体はadvisor/quiz.ts・advisor/yokosawa.tsのまま無変更)。

/** 問題の同一性キー(wrongリストの重複防止・除外に使用)。 */
export function tierKey(q: TierQuestion): string {
  return q.hand.handStr
}

export function ReviewComplete() {
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

export function ScoreBar({ correct, total, streak }: { correct: number; total: number; streak: number }) {
  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
      <span>正解: <strong style={{ color: 'var(--green-light)' }}>{correct}</strong> / {total}</span>
      {total > 0 && <span>正答率: <strong style={{ color: 'var(--gold-light)' }}>{Math.round((correct / total) * 100)}%</strong></span>}
      <span>連続正解: <strong style={{ color: 'var(--gold-light)' }}>{streak}</strong></span>
    </div>
  )
}

export function HandCards({ hand, size = 'xl' }: { hand: RandomHand; size?: 'lg' | 'xl' }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {hand.cards.map((c, i) => <CardView key={i} card={c} size={size} />)}
    </div>
  )
}

export function ResultBanner({ correct, correctLabel }: { correct: boolean; correctLabel: string }) {
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

export function NextButton({ onClick }: { onClick: () => void }) {
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

export type TierQuizProps = {
  reviewMode: boolean
  wrongList: TierQuestion[]
  onWrong: (q: TierQuestion) => void
  onCorrect: (q: TierQuestion) => void
}

export function TierQuiz({ reviewMode, wrongList, onWrong, onCorrect }: TierQuizProps) {
  const [q, setQ] = useState<TierQuestion>(() =>
    reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeTierQuestion()
  )
  const [answered, setAnswered] = useState<YokosawaTier | null>(null)
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0 })
  const [reviewDone, setReviewDone] = useState(false)
  const [showGrid, setShowGrid] = useState(false)

  useEffect(() => {
    const nextQ = reviewMode && wrongList.length > 0
      ? wrongList[Math.floor(Math.random() * wrongList.length)]
      : makeTierQuestion()
    setQ(nextQ)
    setAnswered(null)
    setReviewDone(false)
    setShowGrid(false)
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
    setShowGrid(false)
  }

  return (
    <div>
      <ScoreBar {...score} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <HandCards hand={q.hand} />
        <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>この手はヨコサワモデルで何色？</div>

        {/* 8 色の選択肢 (7ティア + ピンク) */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 560 }}>
          {TIER_DISPLAY_ORDER.map(t => {
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
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}
          >
            <ResultBanner correct={answered === q.correct} correctLabel={TIER_INFO[q.correct].labelJa} />
            <NextButton onClick={next} />
            <button
              onClick={() => setShowGrid(g => !g)}
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--panel-border)', borderRadius: 8,
                padding: '6px 14px', fontSize: 12.5, fontWeight: 500,
              }}
            >
              レンジ表を見る {showGrid ? '▲' : '▼'}
            </button>
            {showGrid && (
              <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
                <YokosawaRangeGrid highlightHand={q.hand.handStr} cellSize={22} />
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
