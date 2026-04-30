import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AdvancedLayerMultiSelect } from './datasourcefieldspanel'

expect.extend(matchers)

afterEach(() => {
  cleanup()
})

describe('AdvancedLayerMultiSelect', () => {
  const baseLayers = [
    { id: 'arcgis:https://example.com/1', name: 'Agro', fields: ['a'] },
    { id: 'custom:layer2', name: 'Layer 2', fields: [] },
    { id: 'geojson:layer3', name: 'Layer 3', fields: ['x', 'y'] },
  ]

  it('filters by search and selects all filtered', () => {
    const onToggle = vi.fn()
    const onSelectMany = vi.fn()
    const onClearMany = vi.fn()

    const Wrapper = () => {
      const [search, setSearch] = React.useState('')
      return (
        <AdvancedLayerMultiSelect
          layers={baseLayers as any}
          selectedIds={new Set()}
          search={search}
          onSearchChange={setSearch}
          onToggle={onToggle}
          onSelectMany={onSelectMany}
          onClearMany={onClearMany}
        />
      )
    }

    render(<Wrapper />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search available layers' }), { target: { value: 'layer 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select all filtered' }))

    expect(onSelectMany).toHaveBeenCalledTimes(1)
    expect(onSelectMany.mock.calls[0][0]).toEqual(['custom:layer2'])
  })

  it('supports Ctrl/Cmd+A and Esc shortcuts', () => {
    const onToggle = vi.fn()
    const onSelectMany = vi.fn()
    const onClearMany = vi.fn()

    render(
      <AdvancedLayerMultiSelect
        layers={baseLayers as any}
        selectedIds={new Set()}
        search=""
        onSearchChange={() => {}}
        onToggle={onToggle}
        onSelectMany={onSelectMany}
        onClearMany={onClearMany}
      />
    )

    const search = screen.getByRole('textbox', { name: 'Search available layers' })
    fireEvent.keyDown(search, { key: 'a', ctrlKey: true })
    expect(onSelectMany).toHaveBeenCalledTimes(1)
    expect(onSelectMany.mock.calls[0][0]).toEqual(baseLayers.map(l => l.id))

    fireEvent.keyDown(search, { key: 'Escape' })
    expect(onClearMany).toHaveBeenCalledTimes(1)
    expect(onClearMany.mock.calls[0][0]).toEqual(baseLayers.map(l => l.id))
  })
})
