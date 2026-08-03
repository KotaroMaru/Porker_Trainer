import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useGtoStore } from '../../gto/store'
import { initialDivergenceStats } from '../../gto/stats/divergence'
import { DivergenceScreen } from './DivergenceScreen'

describe('DivergenceScreen', () => {
  beforeEach(() => {
    useGtoStore.setState({
      divergenceTally: initialDivergenceStats(),
      settings: { mode: 'full', enabledScenarioIds: ['srp_btn_vs_bb'], focusScenarioId: null },
    })
  })

  it('空なら案内し、全ての分解セルにサンプル数を表示する', () => {
    render(<DivergenceScreen />)
    expect(screen.getByText('まだ集計対象の決断がありません。プレイするとここに表示されます。')).toBeInTheDocument()
    expect(screen.getByText('ストリート別')).toBeInTheDocument()
    expect(screen.getAllByText('n=0 / fold可 n=0').length).toBeGreaterThan(10)
  })

  it('全体が最小サンプル未満なら数値と点を描かず「サンプル不足」を出す', () => {
    const stats = initialDivergenceStats()
    Object.assign(stats, {
      decisionCount: 29,
      foldEligibleCount: 29,
      userCount: { fold: 10, passive: 10, aggressive: 9 },
      gtoFreqSum: { fold: 9, passive: 10, aggressive: 10 },
      foldUserCount: 10,
      foldGtoFreqSum: 9,
    })
    useGtoStore.setState({ divergenceTally: stats })
    render(<DivergenceScreen />)
    expect(screen.getAllByText('サンプル不足 (29/30決断)')).toHaveLength(1)
    expect(screen.queryByTestId('divergence-point')).not.toBeInTheDocument()
    expect(screen.queryByText(/X \+/)).not.toBeInTheDocument()
  })

  it('旧データは攻め軸を引き継ぎ、fold軸が集計中であることを明示する', () => {
    const stats = initialDivergenceStats()
    Object.assign(stats, {
      decisionCount: 42,
      legacyDecisionCount: 42,
      userCount: { fold: 8, passive: 20, aggressive: 14 },
      gtoFreqSum: { fold: 10, passive: 18, aggressive: 14 },
    })
    useGtoStore.setState({ divergenceTally: stats })
    render(<DivergenceScreen />)
    expect(screen.getByText('フォールド軸を集計中 (0/30件)')).toBeInTheDocument()
    expect(screen.getByText(/旧データ42件の攻め軸は引き継ぎ済みです/)).toBeInTheDocument()
  })

  it('リセットでv2初期値へ戻す', () => {
    const stats = initialDivergenceStats()
    stats.decisionCount = 1
    useGtoStore.setState({ divergenceTally: stats })
    render(<DivergenceScreen />)
    fireEvent.click(screen.getByText('集計をリセット'))
    expect(useGtoStore.getState().divergenceTally).toEqual(initialDivergenceStats())
  })
})
