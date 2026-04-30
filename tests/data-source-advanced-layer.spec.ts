import { test, expect } from 'playwright/test'

test('settings page shows advanced data source multi-select UI', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'currentUser',
      JSON.stringify({ id: 1, name: 'Admin', email: 'admin@example.com', role: 'Admin' })
    )
  })

  await page.goto('/account/settings')

  await expect(page.getByRole('heading', { name: /Workflow & Data Sources/i })).toBeVisible()

  await page.getByRole('button', { name: /Configure/i }).click()

  await expect(page.getByRole('textbox', { name: 'Search available layers' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select all filtered' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear all filtered' })).toBeVisible()
})
