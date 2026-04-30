import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import * as matchers from '@testing-library/jest-dom/matchers'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import GisContent from './GisContent'

expect.extend(matchers)

type StoreMap = Map<string, Map<string, unknown>>

function installIndexedDbMock() {
  const dbs = new Map<string, StoreMap>()

  const indexedDBMock: IDBFactory = {
    open(name: string, version?: number) {
      const req: any = {}
      const v = typeof version === 'number' ? version : 1
      const existing = dbs.get(name)
      const stores: StoreMap = existing ?? new Map()

      const objectStoreNames = {
        contains: (storeName: string) => stores.has(storeName),
      } as any

      const result: any = {
        name,
        version: v,
        objectStoreNames,
        createObjectStore: (storeName: string) => {
          if (!stores.has(storeName)) stores.set(storeName, new Map())
          return {}
        },
        transaction: (storeName: string, mode: IDBTransactionMode) => {
          const store = stores.get(storeName) ?? new Map()
          stores.set(storeName, store)
          const tx: any = {
            mode,
            objectStore: () => {
              return {
                put: (value: unknown, key: string) => {
                  store.set(key, value)
                  return {}
                },
                get: (key: string) => {
                  const getReq: any = {}
                  setTimeout(() => {
                    getReq.result = store.get(key)
                    getReq.onsuccess?.()
                  }, 0)
                  return getReq
                },
              }
            },
          }
          setTimeout(() => {
            tx.oncomplete?.()
          }, 0)
          return tx
        },
      }

      req.result = result
      setTimeout(() => {
        dbs.set(name, stores)
        if (!existing) req.onupgradeneeded?.()
        req.onsuccess?.()
      }, 0)

      return req as IDBOpenDBRequest
    },
    deleteDatabase() {
      throw new Error('Not implemented')
    },
    cmp() {
      throw new Error('Not implemented')
    },
    databases() {
      return Promise.resolve([])
    },
  } as any

  ;(globalThis as any).indexedDB = indexedDBMock
}

function makeGeoJson(idKey: string, idVal: string) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { [idKey]: idVal, name: 'row-1' },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
    ],
  }
}

describe('GisContent', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installIndexedDbMock()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders empty state when no layers exist', async () => {
    render(<GisContent />)
    expect(await screen.findByText('No layers')).toBeInTheDocument()
  })

  it('adds an uploaded GeoJSON layer and shows fields tab', async () => {
    render(<GisContent />)
    fireEvent.click(await screen.findByRole('button', { name: /Add layer/i }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Upload File' }))
    fireEvent.change(within(dialog).getByLabelText('Layer Name (optional)'), { target: { value: 'Layer A' } })

    const file = new File([JSON.stringify(makeGeoJson('id', '1'))], 'a.geojson', { type: 'application/json' })
    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    fireEvent.click(within(dialog).getByRole('button', { name: /Upload & Import/i }))

    expect(await screen.findByText('Layer A')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Fields' }))
    expect(await screen.findByText('Field Management')).toBeInTheDocument()
    expect(screen.getByText('id')).toBeInTheDocument()
  })

  it('creates a relationship between two layers', async () => {
    render(<GisContent />)

    fireEvent.click(await screen.findByRole('button', { name: /Add layer/i }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Upload File' }))
    fireEvent.change(within(dialog).getByLabelText('Layer Name (optional)'), { target: { value: 'Origin' } })
    let file = new File([JSON.stringify(makeGeoJson('id', '1'))], 'o.geojson', { type: 'application/json' })
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Upload & Import/i }))
    expect(await screen.findByText('Origin')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add layer/i }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Upload File' }))
    fireEvent.change(within(dialog).getByLabelText('Layer Name (optional)'), { target: { value: 'Destination' } })
    file = new File([JSON.stringify(makeGeoJson('id', '2'))], 'd.geojson', { type: 'application/json' })
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Upload & Import/i }))
    expect(await screen.findByText('Destination')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Relationships' }))
    fireEvent.click(screen.getByRole('button', { name: /Add relationship/i }))
    dialog = await screen.findByRole('dialog')

    fireEvent.change(within(dialog).getByLabelText('Relationship name'), { target: { value: 'Rel 1' } })
    const originSelect = within(dialog).getByLabelText('Origin Layer') as HTMLSelectElement
    const originVal = Array.from(originSelect.options).find(o => o.textContent === 'Origin')?.value || originSelect.options[1].value
    fireEvent.change(originSelect, { target: { value: originVal } })

    const destSelect = within(dialog).getByLabelText('Destination Layer') as HTMLSelectElement
    const destVal = Array.from(destSelect.options).find(o => o.textContent === 'Destination')?.value || destSelect.options[1].value
    fireEvent.change(destSelect, { target: { value: destVal } })

    fireEvent.change(within(dialog).getByLabelText('Origin Key Field'), { target: { value: 'id' } })
    fireEvent.change(within(dialog).getByLabelText('Destination Key Field'), { target: { value: 'id' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Rel 1')).toBeInTheDocument()
  })
})
