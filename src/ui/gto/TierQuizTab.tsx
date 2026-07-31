import { useState } from 'react'
import { TierQuiz } from '../quiz/TierQuiz'
import { tierKey } from '../../advisor/quiz'
import type { TierQuestion } from '../../advisor/quiz'

// P12 Phase A-3: 新GTOアプリの「学習」タブ内「色当てクイズ」サブタブ。
// TierQuiz自体はQuizView.tsxと共有(../quiz/TierQuiz.tsx)。復習モード・間違いリストの
// 保持はQuizView.tsx側の実装(モードごとの独立state)と同じパターンをこちらでも踏襲する
// (GTOアプリには他の一問一答モードが無いため、mode切替やwrongCountバッジは不要)。
export function TierQuizTab() {
  const [reviewMode, setReviewMode] = useState(false)
  const [wrongList, setWrongList] = useState<TierQuestion[]>([])

  function addWrong(q: TierQuestion) {
    setWrongList(prev => prev.some(p => tierKey(p) === tierKey(q)) ? prev : [...prev, q])
  }
  function removeWrong(q: TierQuestion) {
    setWrongList(prev => prev.filter(p => tierKey(p) !== tierKey(q)))
  }
  function toggleReviewMode() {
    if (!reviewMode && wrongList.length === 0) return
    setReviewMode(r => !r)
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0, flex: 1 }}>
          手札を見て、その手がヨコサワモデルで何色のティアかを当てます。
        </p>
        <button
          onClick={toggleReviewMode}
          style={{
            background: reviewMode ? 'rgba(217,64,64,0.2)' : 'transparent',
            color: reviewMode ? '#e07070' : wrongList.length > 0 ? 'var(--text-muted)' : 'var(--text-dim)',
            border: '1px solid ' + (reviewMode ? '#e07070' : wrongList.length > 0 ? 'rgba(217,64,64,0.5)' : 'var(--panel-border)'),
            borderRadius: 6,
            padding: '6px 14px', fontSize: 13, fontWeight: reviewMode ? 700 : 400,
            cursor: wrongList.length === 0 && !reviewMode ? 'not-allowed' : 'pointer',
            opacity: wrongList.length === 0 && !reviewMode ? 0.4 : 1,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          {reviewMode ? '× 復習中' : `復習 (${wrongList.length}問)`}
        </button>
      </div>
      <TierQuiz reviewMode={reviewMode} wrongList={wrongList} onWrong={addWrong} onCorrect={removeWrong} />
    </div>
  )
}
