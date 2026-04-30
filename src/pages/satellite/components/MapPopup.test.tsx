import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { LayerData } from './LayerManager'
import { MapPopup } from './MapPopup'

expect.extend(matchers)

afterEach(() => {
  cleanup()
})

const basePopup = {
  layerId: 'l1',
  layerName: 'Layer 1',
  featureKey: 'f1',
  latlng: { lat: 25, lng: 55 },
  phase: 'open' as const,
  feature: {
    type: 'Feature',
    geometry: null,
    properties: {
      Name: 'NH-08',
      Subtype: 1,
      Status: 1,
      Count: 5,
    },
  },
}

const basePos = { left: 10, top: 10, placement: 'bottom' as const, arrowLeft: 50 }

const arcgisLayer: LayerData = {
  id: 'l1',
  name: 'Layer 1',
  type: 'geojson',
  source: 'arcgis',
  visible: true,
  opacity: 1,
  arcgisLayerDefinition: {
    typeIdField: 'Subtype',
    types: [
      {
        id: 1,
        name: 'Type 1',
        domains: {
          Status: {
            type: 'codedValue',
            codedValues: [
              { code: 0, name: 'No' },
              { code: 1, name: 'Yes' },
            ],
          },
        },
      },
    ],
    fields: [
      { name: 'Subtype', alias: 'Subtype', type: 'esriFieldTypeInteger', editable: true, nullable: false },
      {
        name: 'Status',
        alias: 'Status',
        type: 'esriFieldTypeInteger',
        editable: true,
        nullable: true,
        domain: {
          type: 'codedValue',
          codedValues: [
            { code: 0, name: 'No' },
            { code: 1, name: 'Yes' },
          ],
        },
      },
      {
        name: 'Count',
        alias: 'Count',
        type: 'esriFieldTypeInteger',
        editable: true,
        nullable: true,
        domain: { type: 'range', minValue: 0, maxValue: 10 },
      },
    ],
  },
}

describe('MapPopup', () => {
  it('renders a title from feature properties', () => {
    render(
      <MapPopup
        popup={basePopup}
        pos={basePos}
        layer={arcgisLayer}
        onClose={() => {}}
        onOpenTable={() => {}}
        onZoomTo={() => {}}
        onUpdateFeature={() => {}}
      />,
    )
    expect(screen.getByText('NH-08', { selector: '.gis-map-popup-title' })).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <MapPopup
        popup={basePopup}
        pos={basePos}
        layer={arcgisLayer}
        onClose={onClose}
        onOpenTable={() => {}}
        onZoomTo={() => {}}
        onUpdateFeature={() => {}}
      />,
    )

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('validates required and range constraints on save', () => {
    const onUpdateFeature = vi.fn()
    render(
      <MapPopup
        popup={basePopup}
        pos={basePos}
        layer={arcgisLayer}
        onClose={() => {}}
        onOpenTable={() => {}}
        onZoomTo={() => {}}
        onUpdateFeature={onUpdateFeature}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    const subtypeField = screen.getByText('Subtype').closest('.gis-map-popup-field') as HTMLElement
    const subtype = within(subtypeField).getByRole('combobox') as HTMLSelectElement
    fireEvent.change(subtype, { target: { value: '' } })

    const count = screen.getByDisplayValue('5') as HTMLInputElement
    fireEvent.change(count, { target: { value: '20' } })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('Must be between 0 and 10')).toBeInTheDocument()
    expect(onUpdateFeature).not.toHaveBeenCalled()
  })

  it('saves and converts coded values and subtype ids to raw types', () => {
    const onUpdateFeature = vi.fn()
    render(
      <MapPopup
        popup={basePopup}
        pos={basePos}
        layer={arcgisLayer}
        onClose={() => {}}
        onOpenTable={() => {}}
        onZoomTo={() => {}}
        onUpdateFeature={onUpdateFeature}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))

    const statusField = screen.getByText('Status').closest('.gis-map-popup-field') as HTMLElement
    const status = within(statusField).getByRole('combobox') as HTMLSelectElement
    fireEvent.change(status, { target: { value: '0' } })

    const count = screen.getByDisplayValue('5') as HTMLInputElement
    fireEvent.change(count, { target: { value: '6' } })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(onUpdateFeature).toHaveBeenCalledTimes(1)
    const nextFeature = onUpdateFeature.mock.calls[0][0]
    expect(nextFeature.properties.Status).toBe(0)
    expect(nextFeature.properties.Subtype).toBe(1)
    expect(nextFeature.properties.Count).toBe(6)
  })
})
