import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PositionRingPicker } from './PositionRingPicker'
import { SCENARIOS } from '../../gto/data/scenarios'

// P12 Phase C-1: リング図でのマッチアップ選択の結合テスト。
// 全17シナリオがリング操作で到達できること、存在しないペアが選択不可であることを検証する。

describe('PositionRingPicker', () => {
  it('未収録のペア(UTG×SB、SRP/3betいずれにも存在しない)は選択できない', () => {
    const onComplete = vi.fn()
    render(<PositionRingPicker onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'UTG' }))
    const sbBtn = screen.getByRole('button', { name: 'SB' })
    expect(sbBtn).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(sbBtn)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('候補が1つだけのペア(UTG×BB)は相手選択で即座に確定する', () => {
    const onComplete = vi.fn()
    render(<PositionRingPicker onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'UTG' }))
    fireEvent.click(screen.getByRole('button', { name: 'BB' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].id).toBe('srp_utg_vs_bb')
    // BBはUTGよりポストフロップ先手(OOP)なので、UTG視点ではIP=seat1。
    expect(onComplete.mock.calls[0][1]).toBe(1)
  })

  it('候補が複数あるペア(UTG×BTN: SRPコールドコール/3bet)はSRP/3bet選択ステップを経て確定する', () => {
    const onComplete = vi.fn()
    render(<PositionRingPicker onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'UTG' }))
    fireEvent.click(screen.getByRole('button', { name: 'BTN' }))
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByText(/状況を選んでください/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /3ベットポット/ }))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].id).toBe('3bet_utg_vs_btn')
  })

  it('全17シナリオが、対応する自分/相手の席選択(+必要なら状況選択)で到達できる', () => {
    for (const scenario of SCENARIOS) {
      const onComplete = vi.fn()
      const { unmount } = render(<PositionRingPicker onComplete={onComplete} />)
      fireEvent.click(screen.getByRole('button', { name: scenario.raiser.position }))
      const opponentBtn = screen.getByRole('button', { name: scenario.defender.position })
      expect(opponentBtn, `${scenario.id}: opponent seat should be selectable`).not.toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(opponentBtn)
      if (onComplete.mock.calls.length === 0) {
        // 候補複数: このシナリオに対応する選択肢ボタンを探してクリックする。
        const label =
          scenario.defender.role === 'threebettor' ? /3ベットポット/ : scenario.defender.role === 'coldcaller' ? /コールドコール/ : /SRP\(コール\)/
        fireEvent.click(screen.getByRole('button', { name: label }))
      }
      expect(onComplete, `${scenario.id}: should complete`).toHaveBeenCalledTimes(1)
      expect(onComplete.mock.calls[0][0].id).toBe(scenario.id)
      unmount()
    }
  })

  it('「戻る」で相手選択ステップから自分の席選択ステップへ戻れる', () => {
    const onComplete = vi.fn()
    render(<PositionRingPicker onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'CO' }))
    expect(screen.getByText(/相手の席を選んでください/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('← 自分の席を選び直す'))
    expect(screen.getByText('1. あなたの席を選んでください')).toBeInTheDocument()
  })
})
