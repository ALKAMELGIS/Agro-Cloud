import React, { useState } from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FieldVisibilityControl, __test__ } from './FieldVisibilityControl'

expect.extend(matchers)

function Harness({ layerId, fields }: { layerId: string; fields: string[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = fields.filter(f => !hidden.has(f))
  return (
    <div>
      <FieldVisibilityControl layerId={layerId} fields={fields} hiddenFields={hidden} onChangeHiddenFields={setHidden} />
      <div data-testid="visible">{visible.join(',')}</div>
    </div>
  )
}

describe('FieldVisibilityControl', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders and toggles field visibility', async () => {
    render(<Harness layerId="layer-1" fields={['A', 'B']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Field visibility' }))
    expect(await screen.findByRole('dialog', { name: 'Field visibility' })).toBeInTheDocument()

    const toggleA = screen.getByRole('button', { name: 'Hide field A' })
    expect(toggleA).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(toggleA)
    expect(screen.getByTestId('visible')).toHaveTextContent('B')

    const toggleA2 = screen.getByRole('button', { name: 'Show field A' })
    expect(toggleA2).toHaveAttribute('aria-pressed', 'false')
  })

  it('persists hidden fields to localStorage', async () => {
    render(<Harness layerId="layer-2" fields={['Field1', 'Field2']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Field visibility' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide field Field1' }))

    const key = __test__.storageKeyForLayer('layer-2')
    const stored = window.localStorage.getItem(key)
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored as string)).toEqual(['Field1'])
  })

  it('loads persisted hidden fields and ignores unknown fields', async () => {
    const key = __test__.storageKeyForLayer('layer-3')
    window.localStorage.setItem(key, JSON.stringify(['A', 'UNKNOWN']))

    render(<Harness layerId="layer-3" fields={['A', 'B']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Field visibility' }))
    expect(await screen.findByRole('dialog', { name: 'Field visibility' })).toBeInTheDocument()

    expect(screen.getByTestId('visible')).toHaveTextContent('B')
    expect(screen.getByRole('button', { name: 'Show field A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide field B' })).toBeInTheDocument()
  })

  it('closes popover on Escape and click outside', async () => {
    render(<Harness layerId="layer-4" fields={['A']} />)

    fireEvent.click(screen.getByRole('button', { name: 'Field visibility' }))
    expect(await screen.findByRole('dialog', { name: 'Field visibility' })).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(screen.queryByRole('dialog', { name: 'Field visibility' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Field visibility' }))
    expect(await screen.findByRole('dialog', { name: 'Field visibility' })).toBeInTheDocument()

    act(() => {
      document.dispatchEvent(new (window as any).Event('pointerdown', { bubbles: true }))
    })
    expect(screen.queryByRole('dialog', { name: 'Field visibility' })).not.toBeInTheDocument()
  })
})
