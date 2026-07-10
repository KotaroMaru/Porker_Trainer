import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EquityDistChart } from './EquityDistChart'
import type { EquityBucket } from '../../gto/explain/features'

describe('EquityDistChart', () => {
  const buckets: EquityBucket[] = Array.from({ length: 10 }, (_, i) => ({
    lo: i * 10,
    hi: (i + 1) * 10,
    heroPct: i === 5 ? 40 : 6.67,
    villainPct: i === 3 ? 30 : 7.78,
  }))
  const rangeAdvantage = { heroAvg: 0.52, villainAvg: 0.48, verdictJa: 'レンジ優位' }
  const nutsAdvantage = { heroTopPct: 15, villainTopPct: 10, verdictJa: 'ナッツ優位' }

  it('レンジ優位/ナッツ優位のverdict行が数値付きで表示される', () => {
    const { container } = render(<EquityDistChart buckets={buckets} rangeAdvantage={rangeAdvantage} nutsAdvantage={nutsAdvantage} />)
    expect(container.textContent).toContain('レンジ優位')
    expect(container.textContent).toContain('自分平均52%')
    expect(container.textContent).toContain('相手平均48%')
    expect(container.textContent).toContain('ナッツ優位')
  })

  it('各バケットについて自分/相手のバーがtitle付きで描画される', () => {
    render(<EquityDistChart buckets={buckets} rangeAdvantage={rangeAdvantage} nutsAdvantage={nutsAdvantage} />)
    expect(screen.getByTitle('自分 50-60%: 40%')).toBeInTheDocument()
    expect(screen.getByTitle('相手 30-40%: 30%')).toBeInTheDocument()
  })

  it('凡例(自分/相手)が表示される', () => {
    const { container } = render(<EquityDistChart buckets={buckets} rangeAdvantage={rangeAdvantage} nutsAdvantage={nutsAdvantage} />)
    expect(container.textContent).toContain('自分')
    expect(container.textContent).toContain('相手')
  })
})
