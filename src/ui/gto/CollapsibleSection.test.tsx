import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from './CollapsibleSection'

describe('CollapsibleSection', () => {
  it('既定では閉じており、中身は表示されない', () => {
    render(
      <CollapsibleSection title="テストパネル">
        <div>中身のコンテンツ</div>
      </CollapsibleSection>,
    )
    expect(screen.getByText('テストパネル')).toBeInTheDocument()
    expect(screen.queryByText('中身のコンテンツ')).not.toBeInTheDocument()
  })

  it('クリックすると開いて中身が表示され、記号が▼から▲に変わる', () => {
    render(
      <CollapsibleSection title="テストパネル">
        <div>中身のコンテンツ</div>
      </CollapsibleSection>,
    )
    expect(screen.getByText('▼')).toBeInTheDocument()
    fireEvent.click(screen.getByText('テストパネル'))
    expect(screen.getByText('中身のコンテンツ')).toBeInTheDocument()
    expect(screen.getByText('▲')).toBeInTheDocument()
  })

  it('もう一度クリックすると閉じる', () => {
    render(
      <CollapsibleSection title="テストパネル">
        <div>中身のコンテンツ</div>
      </CollapsibleSection>,
    )
    fireEvent.click(screen.getByText('テストパネル'))
    fireEvent.click(screen.getByText('テストパネル'))
    expect(screen.queryByText('中身のコンテンツ')).not.toBeInTheDocument()
  })

  it('defaultOpen=trueなら最初から開いている', () => {
    render(
      <CollapsibleSection title="テストパネル" defaultOpen>
        <div>中身のコンテンツ</div>
      </CollapsibleSection>,
    )
    expect(screen.getByText('中身のコンテンツ')).toBeInTheDocument()
  })
})
