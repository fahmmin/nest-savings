// Real SoDEX testnet: your whitelisted, funded wallet registers Nest's trade-only key, and the agent places real
// testnet orders. Run with `npm run test:live` (sets nothing on its own: needs E2E_LIVE=1, E2E_SEED, E2E_ROOT_SECRET).
import { testWithSynpress } from '@synthetixio/synpress'
import { metaMaskFixtures } from '@synthetixio/synpress/playwright'
import setup from '../wallet-setup/live.setup'
import { agent, connect, fillStart, popupClosed, until } from './helpers'

const test = testWithSynpress(metaMaskFixtures(setup))
const { expect } = test
const SODEX = 'https://testnet-gw.sodex.dev/api/v1'
const sodex = async (path: string) => (await (await fetch(SODEX + path)).json()) as any

test.skip(!process.env.E2E_LIVE, 'Live testnet run: set E2E_LIVE=1 (see e2e/README.md)')

test('live: sign the trade-only key, SoDEX confirms it, and the agent trades on testnet', async ({ page, metamask }) => {
  const health = (await agent('/health')).body
  expect(health.exchange).toBe('live')

  // The account the wallet setup imported.
  await page.goto('/#start')
  await page.locator('header').getByRole('button', { name: 'Connect wallet' }).click()
  await metamask.connectToDapp()
  await popupClosed(page)
  const account = (await page.locator('header .acct-btn').getAttribute('title'))!
  expect(account).toMatch(/^0x[0-9a-fA-F]{40}$/)

  // Preconditions on SoDEX, so a failure says what is missing instead of timing out.
  const state = await sodex(`/spot/accounts/${account}/state`)
  expect(state.data?.aid, 'wallet has no activated SoDEX testnet Spot account').toBeGreaterThan(0)
  const usdc = (await sodex(`/spot/accounts/${account}/balances`)).data?.balances?.find((b: any) => b.coin === 'vUSDC')
  expect(Number(usdc?.total ?? 0) - Number(usdc?.locked ?? 0), 'needs at least 50 vUSDC in Spot').toBeGreaterThanOrEqual(50)

  await fillStart(page, { basket: 'Steady', floor: 15, mode: 'My SoDEX testnet account' })
  await connect(page, metamask, account)
  await page.getByRole('button', { name: 'Sign and start' }).click()
  await metamask.confirmSignature() // EIP-712 UserSignedAddPermissionedAPIKeyAction, permissions 14
  await popupClosed(page)
  await expect(page).toHaveURL(/#home$/, { timeout: 120_000 })

  // The key is on SoDEX with withdraw, transfer and cancel switched off: read straight from the gateway, not from Nest.
  const u = (await agent(`/users/${account}`)).body
  expect(u).toMatchObject({ mode: 'live', status: 'active', apiKey: { canWithdraw: false, canTransfer: false } })
  const keys = await sodex(`/user/${account}/api-keys?name=${u.apiKeyName}`)
  const key = keys.data.spot.find((k: any) => k.name === u.apiKeyName)
  expect(key.permissions & 14).toBe(14)
  expect(key.publicKey.toLowerCase()).toBe(u.apiKey.publicKey.toLowerCase())
  await expect(page.locator('li', { hasText: 'Can withdraw' })).toContainText('No')

  // The first rebalance places real orders; at least one must fill and show up in SoDEX's own order history.
  const log = await until(async () => (await agent(`/users/${account}/log`)).body as any[], (l) => l.some((e) => e.fills?.some((f: any) => f.orderId && (f.status === 'filled' || f.status === 'partial'))), 300_000)
  const fill = log.flatMap((e) => e.fills).find((f: any) => f.orderId && (f.status === 'filled' || f.status === 'partial'))
  const history = await sodex(`/spot/accounts/${account}/orders/history?symbol=${fill.order.symbol}&limit=50`)
  expect(JSON.stringify(history.data)).toContain(fill.orderId)

  // Leave the account paused, so nothing keeps trading after the run.
  await page.goto('/#settings')
  await page.getByRole('button', { name: 'Pause Nest' }).click()
  await metamask.confirmSignature()
  await until(async () => (await agent(`/users/${account}`)).body.status, (s) => s === 'paused')
})
