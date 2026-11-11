import { defineConfig } from '@playwright/test'

// Its own agent (port 8791, fresh database per run) and app (port 5175), so the dev servers are never touched.
export const AGENT = 'http://localhost:8791'
const APP_PORT = 5175
const live = !!process.env.E2E_LIVE
if (live && !process.env.E2E_ROOT_SECRET) throw new Error('Set E2E_ROOT_SECRET in e2e/.env for the live run')

export default defineConfig({
  testDir: './tests',
  workers: 1, // one MetaMask profile and one agent: run one test at a time, never retry silently
  fullyParallel: false,
  retries: 0,
  timeout: live ? 600_000 : 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm --prefix ../agent start',
      url: `${AGENT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: '8791',
        DB_FILE: `${process.cwd()}/.tmp/nest-${live ? 'live' : 'paper'}-${Date.now()}.db`,
        LOOP_MS: '5000',
        EXCHANGE: live ? 'live' : 'paper',
        // The paper run only needs a throwaway root; the live run needs yours, because SoDEX keeps the key derived from it.
        ROOT_SECRET: live ? process.env.E2E_ROOT_SECRET! : 'e2e0000000000000000000000000000000000000000000000000000000000000',
      },
    },
    {
      command: `npm --prefix ../app run dev -- --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_AGENT_URL: AGENT },
    },
  ],
})
