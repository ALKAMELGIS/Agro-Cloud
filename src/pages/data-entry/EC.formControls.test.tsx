import React, { useEffect, useState } from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

expect.extend(matchers)

vi.mock('./components/datasourcefieldspanel', async () => {
  const mod: any = {}
  mod.DataSourceFieldsPanel = function MockPanel(props: any) {
    const [valuesBySource, setValuesBySource] = useState<Record<string, Record<string, string>>>({
      s1: { DripVolume_ml: '', Cycle: '' },
      s2: { Qty_Of_Water_M3: '' },
    })

    useEffect(() => {
      if (props.externalApplyKey === undefined || props.externalApplyKey === null) return
      if (!props.externalValuesBySource) return
      setValuesBySource(props.externalValuesBySource)
    }, [props.externalApplyKey])

    useEffect(() => {
      props.onChange?.({
        sourceIds: Object.keys(valuesBySource),
        selectedFieldsBySource: {
          s1: ['DripVolume_ml', 'Cycle'],
          s2: ['Qty_Of_Water_M3'],
        },
        valuesBySource,
      })
    }, [valuesBySource])

    return (
      <div>
        <div id="ds-source-s1">
          <label>
            DripVolume_ml
            <input
              aria-label="DripVolume_ml"
              value={valuesBySource.s1.DripVolume_ml}
              onChange={(e) => setValuesBySource(prev => ({ ...prev, s1: { ...prev.s1, DripVolume_ml: e.target.value } }))}
            />
          </label>
          <label>
            Cycle
            <input
              aria-label="Cycle"
              value={valuesBySource.s1.Cycle}
              onChange={(e) => setValuesBySource(prev => ({ ...prev, s1: { ...prev.s1, Cycle: e.target.value } }))}
            />
          </label>
        </div>
        <div id="ds-source-s2">
          <label>
            Qty_Of_Water_M3
            <input
              aria-label="Qty_Of_Water_M3"
              value={valuesBySource.s2.Qty_Of_Water_M3}
              onChange={(e) => setValuesBySource(prev => ({ ...prev, s2: { ...prev.s2, Qty_Of_Water_M3: e.target.value } }))}
            />
          </label>
        </div>
      </div>
    )
  }
  return mod
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

beforeEach(() => {
  localStorage.setItem('currentUser', JSON.stringify({ id: 1, email: 'mohamed.abass@eliteprojects.ae', name: 'Mohamed', role: 'Manager' }))
  ;(HTMLElement.prototype as any).scrollIntoView = vi.fn()
})

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('EC form controls', () => {
  it('Quick Fill populates fields from backend latest entry', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        item: { state: { valuesBySource: { s1: { DripVolume_ml: '10', Cycle: '2' }, s2: { Qty_Of_Water_M3: '1.5' } } } },
      }),
    )
    vi.stubGlobal('fetch', fetchMock as any)

    const { default: EC } = await import('./EC')
    render(
      <MemoryRouter>
        <EC />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Quick Fill/i }))

    await waitFor(() => {
      expect(screen.getByLabelText('DripVolume_ml')).toHaveValue('10')
      expect(screen.getByLabelText('Cycle')).toHaveValue('2')
      expect(screen.getByLabelText('Qty_Of_Water_M3')).toHaveValue('1.5')
    })
  })

  it('Clear asks confirmation and then resets inputs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ item: null })))
    const { default: EC } = await import('./EC')
    render(
      <MemoryRouter>
        <EC />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('DripVolume_ml'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /Clear/i }))

    expect(await screen.findByText(/Clear all fields\?/i)).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Clear$/i }))

    await waitFor(() => {
      expect(screen.getByLabelText('DripVolume_ml')).toHaveValue('')
    })
  })

  it('Save & Add Another persists to backend and resets form (Ctrl+S shortcut)', async () => {
    let resolvePost: (v: any) => void = () => {}
    const postPromise = new Promise((r) => (resolvePost = r))
    const fetchMock = vi.fn((url: any, init?: any) => {
      if (String(url).includes('/api/ecph/entries/latest')) return Promise.resolve(jsonResponse({ item: null }))
      if (String(url).includes('/api/ecph/entries') && init?.method === 'POST') return postPromise as any
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const { default: EC } = await import('./EC')
    render(
      <MemoryRouter>
        <EC />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('DripVolume_ml'), { target: { value: '12' } })

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    expect(screen.getByRole('button', { name: /Save and add another/i })).toBeDisabled()

    resolvePost(jsonResponse({ item: { id: 'x1' } }, 201))

    await waitFor(() => {
      expect(screen.getByLabelText('DripVolume_ml')).toHaveValue('')
    })
  })

  it('Esc triggers discard confirmation when dirty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ item: null })))
    const { default: EC } = await import('./EC')
    render(
      <MemoryRouter>
        <EC />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('DripVolume_ml'), { target: { value: '1' } })
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(await screen.findByText(/Discard changes\?/i)).toBeInTheDocument()
  })
})
