import { expect, test } from 'playwright/test'

test.describe('Home grid layout & performance', () => {
  const viewports = [
    { name: 'mobile-320', width: 320, height: 780 },
    { name: 'tablet-768', width: 768, height: 900 },
    { name: 'desktop-1200', width: 1200, height: 900 },
    { name: '4k-3840', width: 3840, height: 1400 },
  ] as const

  for (const vp of viewports) {
    test(`${vp.name}: one-line grid without overlap`, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem(
          'currentUser',
          JSON.stringify({ id: 1, name: 'Test User', email: 'test@example.com', role: 'admin' })
        )
        ;(window as any).__perf = { cls: 0, lcp: 0 }

        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as any[]) {
              if (!e.hadRecentInput) (window as any).__perf.cls += e.value
            }
          }).observe({ type: 'layout-shift', buffered: true } as any)
        } catch {}

        try {
          new PerformanceObserver((list) => {
            const entries = list.getEntries() as any[]
            const last = entries[entries.length - 1]
            if (last?.startTime) (window as any).__perf.lcp = last.startTime
          }).observe({ type: 'largest-contentful-paint', buffered: true } as any)
        } catch {}
      })

      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/', { waitUntil: 'networkidle' })

      const cards = page.locator('.app-icon-card')
      await expect(cards.first()).toBeVisible()
      await expect(cards).toHaveCount(5)

      await page.waitForTimeout(1200)

      const boxes = await cards.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height, revealed: el.classList.contains('is-visible') }
        })
      )

      const visible = boxes
        .map((b, idx) => ({ ...b, idx }))
        .filter((b) => b.x + b.w > -10 && b.x < vp.width + 10 && b.revealed)

      expect(visible.length).toBeGreaterThan(1)
      const y0 = visible[0].y
      for (const b of visible) {
        expect(Math.abs(b.y - y0)).toBeLessThan(2.5)
      }

      const sorted = [...visible].sort((a, b) => a.x - b.x)
      for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1]
        const cur = sorted[i]
        expect(cur.x).toBeGreaterThan(prev.x + prev.w - 2)
      }

      const perf = await page.evaluate(() => (window as any).__perf || { cls: 0, lcp: 0 })
      expect(perf.cls).toBeLessThan(0.1)
      expect(perf.lcp).toBeGreaterThan(0)
      expect(perf.lcp).toBeLessThan(2500)
    })
  }
})
