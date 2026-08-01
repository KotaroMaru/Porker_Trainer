import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { ActionTargets } from '../../gto/explain/features'
import type { BetProfile } from '../../gto/explain/interpretation'
import { BetIntentPanel } from './BetIntentPanel'

const target: ActionTargets = {
  forLabel: 'bet33',
  continueWeakHands: [{ hand: 'AKo', comboCount: 3, weightPct: 60 }],
  foldedHands: [{ hand: 'QJo', comboCount: 2, weightPct: 40 }],
}

function profile(overrides: Partial<BetProfile> = {}): BetProfile {
  return { forLabel: 'bet33', kind: 'value', valueThickness: 'thick', continueEquity: 0.7, foldFreq: 0.3, targetsToShow: 'continueWeak', ...overrides }
}

describe('BetIntentPanel', () => {
  it('profileがnullなら表示しない', () => {
    const { container } = render(<BetIntentPanel profile={null} target={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('valueは継続側だけを表示する', () => {
    const { container } = render(<BetIntentPanel profile={profile()} target={target} />)
    expect(container.textContent).toContain('バリューベット(厚め)')
    expect(container.textContent).toContain('AKo')
    expect(container.textContent).not.toContain('QJo')
  })

  it('エクイティ保護型はfolded側だけを表示する', () => {
    const { container } = render(<BetIntentPanel profile={profile({ kind: 'protection', valueThickness: null, targetsToShow: 'folded' })} target={target} />)
    expect(container.textContent).toContain('エクイティ保護ベット')
    expect(container.textContent).toContain('QJo')
    expect(container.textContent).not.toContain('AKo')
  })

  it('ターゲットが無くても分類バッジは表示する', () => {
    const { container } = render(<BetIntentPanel profile={profile({ kind: 'pureBluff', valueThickness: null, targetsToShow: 'folded' })} target={null} />)
    expect(container.textContent).toContain('フォールド利益型ベット')
  })
})
