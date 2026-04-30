import { defineConfig, devices } from 'playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5177',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--disable-gpu', '--use-angle=swiftshader', '--use-gl=swiftshader', '--disable-features=Vulkan'],
    },
  },
  webServer: {
    command: 'npm run dev:client -- --host 127.0.0.1 --port 5177',
    url: 'http://127.0.0.1:5177',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
