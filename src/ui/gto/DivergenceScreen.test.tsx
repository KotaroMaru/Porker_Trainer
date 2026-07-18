// P11 Phase D-4: DivergenceScreenの表示ロジックの単体テスト。
// store.divergenceTallyを直接setStateし、summarizeDivergence経由の表示
// (自分%/GTO%・差分文言・30決断未満の注記・リセットボタン)を検証する。

import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DivergenceScreen } from './DivergenceScreen'
import { useGtoStore } from '../../gto/store'
import { initialDivergenceTally, type DivergenceTally } from '../../gto/stats/divergence'

describe('DivergenceScreen', () => {
  beforeEach(() => {
    useGtoStore.setState({ divergenceTally: initialDivergenceTally() })
  })

  it('集計が空(count=0)のときは「まだ集計対象の決断がありません」を表示し、注記やバケット行は出さない', () => {
    render(<DivergenceScreen />)
    expect(screen.getByText('まだ集計対象の決断がありません。プレイするとここに表示されます。')).toBeInTheDocument()
    expect(screen.queryByText(/サンプル数が少ないため/)).not.toBeInTheDocument()
  })

  it('30決断未満のときサンプル数注記を表示する', () => {
    const tally: DivergenceTally = {
      decisionCount: 10,
      userCount: { fold: 2, passive: 5, aggressive: 3 },
      gtoFreqSum: { fold: 2, passive: 5, aggressive: 3 },
    }
    useGtoStore.setState({ divergenceTally: tally })
    render(<DivergenceScreen />)
    expect(screen.getByText(/サンプル数が少ないため参考程度です/)).toBeInTheDocument()
  })

  it('30決断以上のときサンプル数注記を表示しない', () => {
    const tally: DivergenceTally = {
      decisionCount: 30,
      userCount: { fold: 10, passive: 10, aggressive: 10 },
      gtoFreqSum: { fold: 10, passive: 10, aggressive: 10 },
    }
    useGtoStore.setState({ divergenceTally: tally })
    render(<DivergenceScreen />)
    expect(screen.queryByText(/サンプル数が少ないため/)).not.toBeInTheDocument()
  })

  it('自分%とGTO%、および差分の言語化文を各バケットについて正しく表示する', () => {
    // count=100固定にして%計算を単純化する。境界値(浮動小数点で閾値5%ちょうどに
    // 丸め誤差が乗ると中立文言に倒れうる)を避け、閾値から明確に離れた差分を使う。
    // fold: user 10%, gto 18% -> diff -8%(閾値超)
    // passive: user 50%, gto 30% -> diff +20%(閾値超)
    // aggressive: user 40%, gto 55% -> diff -15%(閾値超)
    const tally: DivergenceTally = {
      decisionCount: 100,
      userCount: { fold: 10, passive: 50, aggressive: 40 },
      gtoFreqSum: { fold: 18, passive: 30, aggressive: 55 },
    }
    useGtoStore.setState({ divergenceTally: tally })
    render(<DivergenceScreen />)

    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('自分 10% / GTO 18%')).toBeInTheDocument()
    expect(screen.getByText('自分 50% / GTO 30%')).toBeInTheDocument()
    expect(screen.getByText('自分 40% / GTO 55%')).toBeInTheDocument()

    expect(screen.getByText(/降りが-8%少ない/)).toBeInTheDocument()
    expect(screen.getByText(/攻めが-15%少ない/)).toBeInTheDocument()
    expect(screen.getByText(/受けが\+20%多い/)).toBeInTheDocument()
  })

  it('|diff|が閾値未満のときは中立文言(GTOに近い)を表示する', () => {
    const tally: DivergenceTally = {
      decisionCount: 100,
      userCount: { fold: 50, passive: 25, aggressive: 25 },
      gtoFreqSum: { fold: 52, passive: 24, aggressive: 24 },
    }
    useGtoStore.setState({ divergenceTally: tally })
    render(<DivergenceScreen />)
    expect(screen.getByText('降りはGTOに近い頻度です。')).toBeInTheDocument()
  })

  it('リセットボタンをクリックするとdivergenceTallyが初期値に戻る', () => {
    const tally: DivergenceTally = {
      decisionCount: 5,
      userCount: { fold: 1, passive: 2, aggressive: 2 },
      gtoFreqSum: { fold: 1, passive: 2, aggressive: 2 },
    }
    useGtoStore.setState({ divergenceTally: tally })
    render(<DivergenceScreen />)

    fireEvent.click(screen.getByText('集計をリセット'))

    expect(useGtoStore.getState().divergenceTally).toEqual(initialDivergenceTally())
  })
})
