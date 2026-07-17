// P11 Phase A: PlayScreen.tsxから切り出したActionButtonRowの新規テスト。

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionButtonRow } from './ActionButtonRow'

describe('ActionButtonRow', () => {
  it('各アクションのラベルを表示する', () => {
    render(<ActionButtonRow actions={[{ label: 'check', amountBb: 0 }, { label: 'bet33', amountBb: 1.8 }]} onChoose={() => {}} />)
    expect(screen.getByText('チェック')).toBeInTheDocument()
    expect(screen.getByText('ベット 33%')).toBeInTheDocument()
  })

  it('amountBb > 0のときのみ金額サブテキストを表示する', () => {
    render(<ActionButtonRow actions={[{ label: 'check', amountBb: 0 }, { label: 'bet33', amountBb: 1.8 }]} onChoose={() => {}} />)
    expect(screen.queryByText('0.0bb')).not.toBeInTheDocument()
    expect(screen.getByText('1.8bb')).toBeInTheDocument()
  })

  it('クリックするとonChooseがそのアクションのlabelで呼ばれる', () => {
    const onChoose = vi.fn()
    render(<ActionButtonRow actions={[{ label: 'fold', amountBb: 0 }]} onChoose={onChoose} />)
    fireEvent.click(screen.getByText('フォールド'))
    expect(onChoose).toHaveBeenCalledWith('fold')
  })
})
