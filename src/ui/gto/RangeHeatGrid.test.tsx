import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RangeHeatGrid } from './RangeHeatGrid'
import type { Combo } from '../../analysis/range'
import type { Card } from '../../engine/types'
import type { DecodedNode } from '../../gto/loader/binaryFormat'

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit }
}

describe('RangeHeatGrid', () => {
  // AA: check20%/bet33 80%, KK: check90%/bet33 10%。他のハンドはレンジ外。
  const combos: Combo[] = [
    [card(14, 'h'), card(14, 's')], // AA
    [card(13, 'h'), card(13, 's')], // KK
  ]
  const weights = [1, 1]
  const handCount = 2
  const freqs = new Float32Array(4)
  freqs[0 * handCount + 0] = 0.2 // check, AA
  freqs[0 * handCount + 1] = 0.9 // check, KK
  freqs[1 * handCount + 0] = 0.8 // bet33, AA
  freqs[1 * handCount + 1] = 0.1 // bet33, KK
  const node: DecodedNode = { player: 0, actionLabels: ['check', 'bet33'], freqs, evsBb: new Float32Array(4) }

  it('13x13=169セルすべてが描画される', () => {
    const { container } = render(<RangeHeatGrid combos={combos} weights={weights} node={node} />)
    expect(container.querySelectorAll('[data-hand]').length).toBe(169)
  })

  it('レンジ内のハンド(AA/KK)は加重アクション頻度をtitleに含む', () => {
    render(<RangeHeatGrid combos={combos} weights={weights} node={node} />)
    expect(screen.getByTitle('AA: チェック 20% / ベット 33% 80%')).toBeInTheDocument()
    expect(screen.getByTitle('KK: チェック 90% / ベット 33% 10%')).toBeInTheDocument()
  })

  it('レンジ外のハンドは「レンジ外」がtitleに表示される', () => {
    render(<RangeHeatGrid combos={combos} weights={weights} node={node} />)
    expect(screen.getByTitle('72o: レンジ外')).toBeInTheDocument()
  })

  it('混合戦略のセルには頻度分の複数の色帯(絶対配置div)が描画される', () => {
    const { container } = render(<RangeHeatGrid combos={combos} weights={weights} node={node} />)
    const aaCell = container.querySelector('[data-hand="AA"]')
    expect(aaCell).not.toBeNull()
    expect(aaCell!.children.length).toBe(3) // check帯 + bet33帯 + ハンドラベル
  })

  it('セルにはハンド表記のラベルテキストが表示される', () => {
    const { container } = render(<RangeHeatGrid combos={combos} weights={weights} node={node} />)
    const aaCell = container.querySelector('[data-hand="AA"]')
    const emptyCell = container.querySelector('[data-hand="72o"]')
    expect(aaCell!.textContent).toBe('AA')
    expect(emptyCell!.textContent).toBe('72o')
  })

  it('highlightHandで指定したセルにgoldのoutlineが付く', () => {
    const { container } = render(<RangeHeatGrid combos={combos} weights={weights} node={node} highlightHand="AA" />)
    const aaCell = container.querySelector('[data-hand="AA"]') as HTMLElement
    const kkCell = container.querySelector('[data-hand="KK"]') as HTMLElement
    expect(aaCell.style.outline).toContain('var(--gold)')
    expect(kkCell.style.outline).not.toContain('var(--gold)')
  })

  it('レンジ外セルには色帯が描画されない(ラベルのみ1件)', () => {
    const { container } = render(<RangeHeatGrid combos={combos} weights={weights} node={node} />)
    const emptyCell = container.querySelector('[data-hand="72o"]')
    expect(emptyCell!.children.length).toBe(1) // ハンドラベルのみ
  })
})
