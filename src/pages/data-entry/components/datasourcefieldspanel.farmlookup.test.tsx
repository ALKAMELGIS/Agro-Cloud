import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { DataSourceFieldsPanel } from './datasourcefieldspanel'

expect.extend(matchers)

const STORAGE_KEY = 'form_data_source_bindings_v1'

const agroId =
  'arcgis:https://services1.arcgis.com/jz3ndhbYV5K9NwI8/ArcGIS/rest/services/Agro_Structures/FeatureServer/21'
const cropsId =
  'arcgis:https://services1.arcgis.com/jz3ndhbYV5K9NwI8/ArcGIS/rest/services/Crops_Planted/FeatureServer/0'

const savedLayers = [
  { id: agroId, name: 'Agro_Structures', fields: ['Farm_Code', 'Farm_Name'] },
  { id: cropsId, name: 'Crops_Planted', fields: ['Farm_Code', 'Farm_Name'] },
]

const writeTestBindings = () => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      TestForm: {
        sourceIds: [agroId, cropsId],
        fieldConfigsBySource: {
          [agroId]: [
            { name: 'Farm_Code', enabled: true, required: true },
            { name: 'Farm_Name', enabled: true, required: false },
          ],
          [cropsId]: [
            { name: 'Farm_Code', enabled: true, required: true },
            { name: 'Farm_Name', enabled: true, required: false },
          ],
        },
      },
    })
  )
}

const makeFetchJson = () =>
  vi.fn(async (url: string) => {
    const u = new URL(url)
    const where = u.searchParams.get('where') ?? ''
    if (where.includes('Farm_Code LIKE')) {
      if (where.toUpperCase().includes("%ZZZ%")) return { features: [] }
      return {
        features: [{ attributes: { Farm_Code: 'F001', Farm_Name: 'Farm One' } }],
      }
    }
    if (where.includes("Farm_Code='F001'")) {
      return {
        features: [
          {
            attributes: { Farm_Code: 'F001', Farm_Name: 'Farm One' },
            geometry: { rings: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
          },
        ],
      }
    }
    if (where.toUpperCase().includes("FARM_CODE='ZZZ'")) return { features: [] }
    return { features: [] }
  })

beforeEach(() => {
  localStorage.clear()
  writeTestBindings()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

describe('DataSourceFieldsPanel farm lookup linkage', () => {
  it('populates Farm_Code and Farm_Name in Crops_Planted when selecting a Farm_Code suggestion', async () => {
    const fetchJson = makeFetchJson()
    const onChange = vi.fn()

    render(
      <DataSourceFieldsPanel
        formKey="TestForm"
        mode="fill"
        onChange={onChange}
        testOverrides={{
          loadSavedLayers: async () => savedLayers as any,
          fetchJson,
          farmSuggestDebounceMs: 0,
        }}
      />
    )

    const cropsFarmCode = await screen.findByLabelText('Crops_Planted:Farm_Code (smart lookup)')
    fireEvent.change(cropsFarmCode, { target: { value: 'F0' } })

    const suggestion = await screen.findByText('F001')
    fireEvent.click(suggestion)

    await waitFor(() => {
      const calls = onChange.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const last = calls[calls.length - 1][0]
      expect(last.valuesBySource[cropsId]?.Farm_Code).toBe('F001')
      expect(last.valuesBySource[cropsId]?.Farm_Name).toBe('Farm One')
    })
  })

  it('propagates Agro_Structures Farm_Code selection to Crops_Planted values', async () => {
    const fetchJson = makeFetchJson()
    const onChange = vi.fn()

    render(
      <DataSourceFieldsPanel
        formKey="TestForm"
        mode="fill"
        onChange={onChange}
        testOverrides={{
          loadSavedLayers: async () => savedLayers as any,
          fetchJson,
        }}
      />
    )

    const agroFarmCode = await screen.findByLabelText('Agro_Structures:Farm_Code (smart lookup)')
    fireEvent.change(agroFarmCode, { target: { value: 'F001' } })
    fireEvent.blur(agroFarmCode)

    await waitFor(() => {
      const calls = onChange.mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const last = calls[calls.length - 1][0]
      expect(last.valuesBySource[agroId]?.Farm_Code).toBe('F001')
      expect(last.valuesBySource[cropsId]?.Farm_Code).toBe('F001')
      expect(last.valuesBySource[cropsId]?.Farm_Name).toBe('Farm One')
    })
  })

  it('clears invalid Farm_Code and shows an error when Farm_Code does not exist', async () => {
    const fetchJson = makeFetchJson()

    render(
      <DataSourceFieldsPanel
        formKey="TestForm"
        mode="fill"
        testOverrides={{
          loadSavedLayers: async () => savedLayers as any,
          fetchJson,
          farmSuggestDebounceMs: 0,
        }}
      />
    )

    const cropsFarmCode = await screen.findByLabelText('Crops_Planted:Farm_Code (smart lookup)')
    fireEvent.change(cropsFarmCode, { target: { value: 'ZZZ' } })
    fireEvent.blur(cropsFarmCode)

    await waitFor(() => {
      expect(screen.getByText('Farm code not found')).toBeInTheDocument()
      expect((cropsFarmCode as HTMLInputElement).value).toBe('')
    })
  })
})

describe('DataSourceFieldsPanel Valve_No lookup (EC)', () => {
  const valveId =
    'arcgis:https://services1.arcgis.com/jz3ndhbYV5K9NwI8/ArcGIS/rest/services/Irrigation_System_Valve/FeatureServer/0'

  const writeEcValveBindings = () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        EC: {
          sourceIds: [valveId],
          fieldConfigsBySource: {
            [valveId]: [{ name: 'Valve_No', enabled: true, required: false }],
          },
        },
      }),
    )
  }

  it('hides browse button and keeps Valve_No input editable', async () => {
    localStorage.clear()
    writeEcValveBindings()

    const fetchJson = vi.fn(async (url: string) => {
      const u = new URL(url)
      const where = u.searchParams.get('where') ?? ''
      const offset = Number(u.searchParams.get('resultOffset') ?? '0')
      if (where.trim() === '1=1') {
        if (offset > 0) return { features: [] }
        return {
          features: [
            { attributes: { Valve_No: '1', OBJECTID: 1 } },
            { attributes: { Valve_No: '2', OBJECTID: 2 } },
            { attributes: { Valve_No: '10', OBJECTID: 10 } },
          ],
        }
      }
      return { features: [] }
    })

    render(
      <DataSourceFieldsPanel
        formKey="EC"
        mode="fill"
        testOverrides={{
          loadSavedLayers: async () =>
            [
              { id: valveId, name: 'Irrigation_System_Valve', fields: ['Valve_No'] },
            ] as any,
          fetchJson,
        }}
      />,
    )

    const input = await screen.findByLabelText('Irrigation_System_Valve:Valve_No (valve lookup)')
    expect(screen.queryByRole('button', { name: 'Irrigation_System_Valve:Browse valves' })).not.toBeInTheDocument()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '10' } })
    expect((input as HTMLInputElement).value).toBe('10')
  })
})

describe('DataSourceFieldsPanel field search is isolated per layer (settings)', () => {
  const l1 = 'arcgis:https://example.com/layer1'
  const l2 = 'arcgis:https://example.com/layer2'

  const writeSettingsBindings = () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        EC: {
          sourceIds: [l1, l2],
          fieldConfigsBySource: {
            [l1]: [{ name: 'Farm_Name', enabled: true, required: false }],
            [l2]: [{ name: 'Qty_Of_Water_M3', enabled: true, required: false }],
          },
        },
      }),
    )
  }

  it('keeps each Search fields input independent and does not mix results', async () => {
    localStorage.clear()
    writeSettingsBindings()

    render(
      <DataSourceFieldsPanel
        formKey="EC"
        mode="settings"
        testOverrides={{
          loadSavedLayers: async () =>
            [
              {
                id: l1,
                name: 'Irrigation_System_Valve',
                arcgisLayerDefinition: { fields: [{ name: 'Farm_Name' }, { name: 'Farm_Code' }, { name: 'Valve_No' }] },
              },
              {
                id: l2,
                name: 'EC_PH_Form',
                arcgisLayerDefinition: { fields: [{ name: 'Farm_Code' }, { name: 'Farm_Name' }, { name: 'Qty_Of_Water_M3' }] },
              },
            ] as any,
        }}
      />,
    )

    const toggle = screen.getByRole('button', { name: /Configure|Close/ })
    if (toggle.textContent?.trim() === 'Configure') fireEvent.click(toggle)

    const search1 = await screen.findByRole('textbox', { name: 'Irrigation_System_Valve:Search fields' })
    const search2 = await screen.findByRole('textbox', { name: 'EC_PH_Form:Search fields' })
    const card1 = (search1 as HTMLInputElement).parentElement?.parentElement as HTMLElement
    const card2 = (search2 as HTMLInputElement).parentElement?.parentElement as HTMLElement

    fireEvent.change(search1, { target: { value: 'Valve' } })

    expect((search1 as HTMLInputElement).value).toBe('Valve')
    expect((search2 as HTMLInputElement).value).toBe('')

    expect(within(card1).getByText('Valve_No')).toBeInTheDocument()
    expect(within(card1).queryByText('Farm_Name')).not.toBeInTheDocument()
    expect(within(card1).queryByText('Farm_Code')).not.toBeInTheDocument()
    expect(within(card2).getByText('Qty_Of_Water_M3')).toBeInTheDocument()

    fireEvent.change(search2, { target: { value: 'Qty' } })

    expect((search1 as HTMLInputElement).value).toBe('Valve')
    expect((search2 as HTMLInputElement).value).toBe('Qty')

    expect(within(card2).getByText('Qty_Of_Water_M3')).toBeInTheDocument()
    expect(within(card2).queryByText('Farm_Name')).not.toBeInTheDocument()
    expect(within(card2).queryByText('Farm_Code')).not.toBeInTheDocument()
    expect(within(card2).queryByText('Valve_No')).not.toBeInTheDocument()
    expect(within(card1).getByText('Valve_No')).toBeInTheDocument()
  })
})
