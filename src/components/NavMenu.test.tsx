import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import NavMenu from './NavMenu'

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('currentUser', JSON.stringify({ role: 'Admin' }))
  localStorage.setItem('appNotifications', JSON.stringify([]))
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('max-width') ? window.innerWidth <= 768 : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NavMenu vertical responsive', () => {
  it('renders vertical nav semantics and ARIA in desktop viewport', () => {
    setViewport(1280)
    render(
      <MemoryRouter>
        <NavMenu />
      </MemoryRouter>,
    )
    const nav = screen.getByRole('navigation', { name: /primary/i })
    expect(nav).toBeInTheDocument()
    expect(nav).toHaveClass('navmenu')
    expect(nav).toHaveAttribute('data-viewport', 'desktop')
    expect(screen.getByRole('button', { name: /collapse navigation/i })).toBeInTheDocument()
  })

  it('opens and closes group with keyboard and keeps aria-expanded updated', () => {
    setViewport(1280)
    render(
      <MemoryRouter>
        <NavMenu />
      </MemoryRouter>,
    )
    const ops = screen.getByRole('button', { name: /operations/i })
    expect(ops).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(ops, { key: 'Enter' })
    expect(ops).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(ops, { key: 'Escape' })
    expect(ops).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows hamburger and collapsible menu in mobile viewport', () => {
    setViewport(390)
    render(
      <MemoryRouter>
        <NavMenu />
      </MemoryRouter>,
    )
    const toggle = screen.getByRole('button', { name: /open navigation menu/i })
    expect(toggle).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: /close navigation menu/i })).toBeInTheDocument()
  })

  it('handles touch-style close when tapping outside', () => {
    setViewport(390)
    render(
      <MemoryRouter>
        <div data-testid="outside">outside</div>
        <NavMenu />
      </MemoryRouter>,
    )
    const toggle = screen.getByRole('button', { name: /open navigation menu/i })
    fireEvent.click(toggle)
    fireEvent.touchStart(document.body)
    expect(screen.getByRole('button', { name: /open navigation menu/i })).toBeInTheDocument()
  })
})
