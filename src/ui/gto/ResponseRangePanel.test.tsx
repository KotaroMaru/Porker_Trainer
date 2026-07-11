import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResponseRangePanel } from './ResponseRangePanel'
import type { ActionResponseSummary } from '../../gto/explain/features'

describe('ResponseRangePanel', () => {
  const responses: ActionResponseSummary[] = [
    { forLabel: 'check', terminal: false, breakdown: [{ label: 'check', freq: 0.6 }, { label: 'bet33', freq: 0.4 }], foldFreq: 0, heroEquityVsContinueRange: 0.52 },
    { forLabel: 'bet33', terminal: false, breakdown: [{ label: 'fold', freq: 0.3 }, { label: 'call', freq: 0.7 }], foldFreq: 0.3, heroEquityVsContinueRange: null },
    { forLabel: 'fold', terminal: true, breakdown: [], foldFreq: 0, heroEquityVsContinueRange: null },
  ]

  it('terminal:falseのアクションはフォールド率と応答内訳バーを表示する', () => {
    const { container } = render(<ResponseRangePanel responses={responses} chosenLabel="check" bestLabel="bet33" />)
    expect(container.textContent).toContain('フォールド率 30%')
    expect(screen.getByTitle('フォールド 30%')).toBeInTheDocument()
    expect(screen.getByTitle('コール 70%')).toBeInTheDocument()
  })

  it('heroEquityVsContinueRangeがある場合は継続レンジへのエクイティを表示する', () => {
    const { container } = render(<ResponseRangePanel responses={responses} chosenLabel="check" bestLabel="bet33" />)
    expect(container.textContent).toContain('継続レンジへのエクイティ 52%')
  })

  it('terminal:trueのアクションは代替文言を表示し、内訳バーは描画しない', () => {
    render(<ResponseRangePanel responses={responses} chosenLabel="check" bestLabel="bet33" />)
    expect(screen.getByText('この選択で決断は終了します(相手の追加アクションなし)。')).toBeInTheDocument()
  })

  it('bestLabelには★マークが付き、chosenLabelには選択済みマークが付く', () => {
    const { container } = render(<ResponseRangePanel responses={responses} chosenLabel="check" bestLabel="bet33" />)
    expect(container.textContent).toContain('★ ベット 33%')
    expect(screen.getByText('(あなたの選択)')).toBeInTheDocument()
  })

  it('P7-4: 帯の下にホバー無しでも全セグメントの頻度%が常時表示される', () => {
    render(<ResponseRangePanel responses={responses} chosenLabel="check" bestLabel="bet33" />)
    // 'check'応答のbreakdown(check 60% / bet33 40%)が凡例テキストとして表示される。
    expect(screen.getByText('チェック 60%')).toBeInTheDocument()
    expect(screen.getByText('ベット 33% 40%')).toBeInTheDocument()
    // 'bet33'応答のbreakdown(fold 30% / call 70%)も同様。
    expect(screen.getByText('フォールド 30%')).toBeInTheDocument()
    expect(screen.getByText('コール 70%')).toBeInTheDocument()
  })
})
