import { expect, type Page } from '@playwright/test'
import type { MetaMask } from '@synthetixio/synpress/playwright'
import { AGENT } from '../playwright.config'

export const DEMO = '0x5aFE000000000000000000000000000000000001'
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}` // same as app/src/format.ts short()

export async function agent<T = any>(path: string): Promise<{ status: number; body: T }> {
  const r = await fetch(AGENT + path)
  return { status: r.status, body: await r.json() }
}

// MetaMask closes its popup a moment after you answer it. Without this wait, the next
// metamask.* call can grab that closing popup instead of the new one ("Target page ... has been closed").
export const popupClosed = (page: Page) =>
  expect.poll(() => page.context().pages().filter((p) => p.url().includes('/notification.html')).length).toBe(0)

/** Connects MetaMask from the header button and waits for the short address to show. */
export async function connect(page: Page, metamask: MetaMask, account: string) {
  const header = page.locator('header')
  await header.getByRole('button', { name: 'Connect wallet' }).click()
  await metamask.connectToDapp()
  await expect(header.getByRole('button', { name: short(account) })).toHaveAttribute('title', new RegExp(account, 'i'))
  await popupClosed(page)
}

/** Fills the Get started form (steps 1, 2 and 4). */
export async function fillStart(page: Page, o: { basket: string; floor: number; mode: 'Practice money' | 'My SoDEX testnet account' }) {
  await page.goto('/#start')
  await page.getByRole('radio', { name: new RegExp(`^${o.basket}`) }).check()
  await page.getByLabel('Move everything to dollars if my savings drop by').fill(String(o.floor))
  await page.getByRole('radio', { name: new RegExp(`^${o.mode}`) }).check()
}

/** Polls the agent until fn(value) is true and returns the value. */
export async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean, timeout = 60_000): Promise<T> {
  let last!: T
  await expect.poll(async () => ok((last = await get())), { timeout, intervals: [1000, 2000, 5000] }).toBe(true)
  return last
}
