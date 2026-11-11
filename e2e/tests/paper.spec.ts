// The whole app with a real MetaMask and practice money. Prices and fills come from the live SoDEX testnet books.
import { testWithSynpress } from '@synthetixio/synpress'
import { metaMaskFixtures } from '@synthetixio/synpress/playwright'
import setup from '../wallet-setup/test.setup'
import { agent, connect, DEMO, fillStart, popupClosed, until } from './helpers'

const test = testWithSynpress(metaMaskFixtures(setup))
const { expect } = test
const ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' // anvil account #0 of the public test mnemonic

test('landing and baskets work without a wallet', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Savings that look after themselves')
  await expect(page.getByText('Demo account, practice money')).toBeVisible() // live phone cards from the agent
  await page.goto('/#discover')
  await expect(page.getByRole('link', { name: 'Start with this basket' }).or(page.getByRole('button', { name: 'Start with this basket' }))).toHaveCount(4)
  await expect(page.getByText(/Bitcoin ETFs over the last 5 days/).first()).toBeVisible()
})

test('crash replay runs without a wallet and reacts to the sliders', async ({ page }) => {
  await page.goto('/#crash')
  const result = page.getByText(/The floor saved you \$[\d,.]+|The floor cost you \$[\d,.]+/)
  await expect(result).toBeVisible()
  const before = await result.textContent()
  await page.getByLabel(/Crash size/).fill('70')
  await expect(result).not.toHaveText(before!)
})

test('the public demo account is read-only', async ({ page }) => {
  await page.goto(`/#home-${DEMO}`)
  await expect(page.getByText(/read only/i).first()).toBeVisible()
  await expect(page.getByText(/practice money/i).first()).toBeVisible()
  await page.goto('/#settings')
  await expect(page.getByText(/someone else's savings/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Sign and save|Pause Nest/ })).toHaveCount(0)
})

test.describe('practice account with MetaMask', () => {
  test.describe.configure({ mode: 'serial' }) // later tests use the account the sign-up test opens

  test('rejecting the signature opens nothing', async ({ page, metamask }) => {
    await fillStart(page, { basket: 'Growth', floor: 20, mode: 'Practice money' })
    await connect(page, metamask, ACCOUNT)
    await page.getByRole('button', { name: 'Sign and start' }).click()
    await metamask.rejectSignature()
    await popupClosed(page)
    await expect(page.locator('.notice.bad')).toBeVisible()
    expect((await agent(`/users/${ACCOUNT}`)).status).toBe(404)
  })

  test('sign-up: one free signature opens the account and Nest buys the basket', async ({ page, metamask }) => {
    await fillStart(page, { basket: 'Growth', floor: 20, mode: 'Practice money' })
    await connect(page, metamask, ACCOUNT)
    await page.getByRole('button', { name: 'Sign and start' }).click()
    await metamask.confirmSignature()
    await popupClosed(page)
    await expect(page).toHaveURL(/#home$/, { timeout: 60_000 })
    await expect(page.getByText('Growth basket, practice money')).toBeVisible()

    const u = (await agent(`/users/${ACCOUNT}`)).body
    expect(u).toMatchObject({ mode: 'paper', status: 'active', basketId: 'growth', floorPct: 20 })
    const bought = await until(async () => (await agent(`/users/${ACCOUNT}`)).body, (v) => v.holdings.some((h: any) => h.symbol === 'vBTC_vUSDC' && h.qty > 0))
    expect(bought.valueUsd).toBeGreaterThan(950) // $1,000 less fees and spread
    await expect(page.getByText('Active').first()).toBeVisible()
  })

  test('activity: every note is verified in the browser', async ({ page, metamask }) => {
    await page.goto('/#activity')
    await connect(page, metamask, ACCOUNT)
    await expect(page.getByText('Verified').first()).toBeVisible()
    await expect(page.getByText(/Not signed by Nest|Bad signature/)).toHaveCount(0)
    const log = (await agent(`/users/${ACCOUNT}/log`)).body as any[]
    expect(log.map((e) => e.kind)).toContain('link')
    expect(log.some((e) => e.kind === 'rebalance')).toBe(true)
  })

  test('settings: change the floor, pause and resume, each with one signature', async ({ page, metamask }) => {
    await page.goto('/#settings')
    await connect(page, metamask, ACCOUNT)

    await page.getByLabel('Move everything to dollars if my savings drop by').fill('25')
    await page.getByRole('button', { name: 'Sign and save changes' }).click()
    await metamask.confirmSignature()
    await popupClosed(page)
    await until(async () => (await agent(`/users/${ACCOUNT}`)).body.floorPct, (f) => f === 25)

    await page.getByRole('button', { name: 'Pause Nest' }).click()
    await metamask.confirmSignature()
    await popupClosed(page)
    await until(async () => (await agent(`/users/${ACCOUNT}`)).body.status, (s) => s === 'paused')

    await page.getByRole('button', { name: 'Resume' }).click()
    await metamask.confirmSignature()
    await popupClosed(page)
    await until(async () => (await agent(`/users/${ACCOUNT}`)).body.status, (s) => s === 'active')

    const kinds = ((await agent(`/users/${ACCOUNT}/log`)).body as any[]).map((e) => e.kind)
    expect(kinds).toEqual(expect.arrayContaining(['settings', 'resume']))
  })

  test('a wallet that already has an account cannot sign up twice', async ({ page, metamask }) => {
    await fillStart(page, { basket: 'Steady', floor: 15, mode: 'Practice money' })
    await connect(page, metamask, ACCOUNT)
    await expect(page.getByRole('button', { name: 'Sign and start' })).toBeDisabled()
  })
})
