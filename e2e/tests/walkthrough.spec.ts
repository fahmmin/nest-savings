// Records a captioned product walkthrough (under 3 minutes) with the real app, agent and MetaMask.
// Run: npm run walkthrough  → e2e/demo/nest-walkthrough.mp4
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test'
import { MetaMask, getExtensionId, unlockForFixture } from '@synthetixio/synpress/playwright'
import { CACHE_DIR_NAME, prepareExtension } from '@synthetixio/synpress-cache'
import setup from '../wallet-setup/test.setup'
import { DEMO, popupClosed } from './helpers'

const SIZE = { width: 1280, height: 720 }

// Same as Synpress's metaMaskFixtures, plus recordVideo (Synpress launches its context without it).
const test = base.extend<{ context: BrowserContext; metamask: MetaMask }>({
  context: async ({}, use, info) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nest-walk-'))
    await fs.cp(path.join(process.cwd(), CACHE_DIR_NAME, setup.hash), dir, { recursive: true })
    const ext = await prepareExtension()
    const context = await chromium.launchPersistentContext(dir, {
      headless: false,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--force-device-scale-factor=1', '--window-size=1280,900', ...(process.env.HEADLESS ? ['--headless=new'] : [])],
      // Synpress runs Chromium "headed", so tabs and toolbar take window height: an emulated 720px viewport records
      // only ~573px. Instead the page follows the real window, which the page fixture sizes to exactly SIZE.
      viewport: null,
      recordVideo: { dir: info.outputPath('video'), size: SIZE },
    })
    const id = await getExtensionId(context, 'MetaMask')
    const wallet = context.pages()[0]
    await wallet.goto(`chrome-extension://${id}/home.html`)
    await unlockForFixture(wallet, setup.walletPassword)
    await use(context)
    await context.close()
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  },
  metamask: async ({ context }, use) => {
    await use(new MetaMask(context, context.pages()[0], setup.walletPassword, await getExtensionId(context, 'MetaMask')))
  },
  page: async ({ context }, use) => {
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    for (let i = 0; i < 3; i++) {
      const inner = await page.evaluate(() => [innerWidth, innerHeight])
      if (inner[0] === SIZE.width && inner[1] === SIZE.height) break
      const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId })
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', width: bounds.width! + SIZE.width - inner[0], height: bounds.height! + SIZE.height - inner[1] } })
      await page.waitForTimeout(300)
    }
    expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([SIZE.width, SIZE.height])
    ;(page as any).t0 = Date.now() // the page's video starts here
    await use(page)
    // The context also records MetaMask's own tab; tell scripts/walkthrough.ts which file is the app.
    await fs.writeFile(path.join(process.cwd(), 'test-results', 'walkthrough-video.txt'), await page.video()!.path())
  },
})

/** On-screen caption, re-added after each full page load. */
async function caption(page: Page, text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById('walk-cap')
    if (!el) {
      el = document.createElement('div')
      el.id = 'walk-cap'
      el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;max-width:860px;padding:12px 20px;border-radius:14px;background:rgba(35,42,84,.94);color:#fff;font:600 18px/1.35 Inter,system-ui,sans-serif;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.25);pointer-events:none'
      document.body.appendChild(el)
    }
    el.textContent = t
  }, text)
}
const pause = (page: Page, s: number) => page.waitForTimeout(s * 1000)
const scroll = (page: Page, y: number) => page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y)
const go = async (page: Page, hash: string, text: string) => {
  await page.evaluate((h) => { window.location.hash = h; window.scrollTo(0, 0) }, hash)
  await caption(page, text)
}

test('walkthrough', async ({ page, metamask }) => {
  test.setTimeout(300_000)

  // 1. Landing (≈25s)
  await page.goto('/')
  await expect(page.getByText('Demo account, practice money')).toBeVisible()
  await caption(page, 'Nest: savings for beginners. Pick a basket, set one safety floor, and an agent keeps it on target on SoDEX.')
  // Everything before this moment (MetaMask unlocking, first load) is cut from the video by scripts/walkthrough.ts.
  await fs.writeFile(path.join(process.cwd(), 'test-results', 'walkthrough-start.txt'), String((Date.now() - (page as any).t0) / 1000))
  await pause(page, 6)
  await scroll(page, 620)
  await caption(page, 'These cards are live: a public demo account the agent runs on SoDEX testnet prices.')
  await pause(page, 6)
  await scroll(page, 1500)
  await caption(page, 'The agent can buy and sell for you. It can never withdraw: SoDEX enforces that on its key.')
  await pause(page, 6)

  // 2. Baskets (≈18s)
  await go(page, '#discover', 'Four ready-made baskets, from careful to bold. No coin picking.')
  await pause(page, 6)
  await scroll(page, 380)
  await caption(page, 'SoSoValue data leans each basket a little: ETF flows and market mood, each with its source.')
  await pause(page, 7)

  // 3. Crash replay (≈18s)
  await go(page, '#crash', 'What if prices crash? The same decision code runs on a made-up crash.')
  await expect(page.getByText(/The floor saved you/)).toBeVisible()
  await pause(page, 5)
  await page.getByLabel(/Crash size/).fill('60')
  await caption(page, 'A 60% crash: the safety floor moves everything to dollars and limits the loss.')
  await pause(page, 7)

  // 4. Sign up with MetaMask (≈35s)
  await go(page, '#start', 'Getting started takes four choices and one free signature.')
  await pause(page, 3)
  await page.getByRole('radio', { name: /^Growth/ }).check()
  await pause(page, 2)
  await page.getByLabel('Move everything to dollars if my savings drop by').fill('20')
  await caption(page, 'Growth basket, 20% safety floor. Counted from the highest value, so it rises as savings grow.')
  await pause(page, 4)
  await page.getByRole('radio', { name: /^Practice money/ }).check()
  await scroll(page, 2000)
  await caption(page, 'Practice money: $1,000, priced and filled against the live SoDEX testnet order books.')
  await pause(page, 3)
  await page.locator('header').getByRole('button', { name: 'Connect wallet' }).click()
  await metamask.connectToDapp()
  await popupClosed(page)
  await caption(page, 'Wallet connected. MetaMask now asks for one signature. It costs nothing.')
  await page.getByRole('button', { name: 'Sign and start' }).click()
  await pause(page, 2)
  await metamask.confirmSignature()
  await popupClosed(page)
  await expect(page).toHaveURL(/#home$/, { timeout: 60_000 })

  // 5. My money (≈20s)
  await caption(page, 'Done. Nest is already buying the basket. Thin testnet books fill over a few checks.')
  await pause(page, 8)
  await scroll(page, 450)
  await caption(page, 'Holdings against target, the safety floor, and every note the agent wrote.')
  await pause(page, 7)

  // 6. Activity (≈15s)
  await go(page, '#activity', 'Every trade and change is signed by the agent. Your browser checks each signature: Verified.')
  await expect(page.getByText('Verified').first()).toBeVisible()
  await pause(page, 8)

  // 7. Settings (≈20s)
  await go(page, '#settings', 'Changing the plan takes a wallet signature, so only you can do it.')
  await pause(page, 3)
  await page.getByLabel('Move everything to dollars if my savings drop by').fill('25')
  await page.getByRole('button', { name: 'Sign and save changes' }).click()
  await metamask.confirmSignature()
  await popupClosed(page)
  await caption(page, 'Floor raised to 25%. Pause and resume work the same way.')
  await pause(page, 6)

  // 8. Demo account and close (≈10s)
  await go(page, `#home-${DEMO}`, 'Judges can open the public demo account with no wallet. Nest: savings that look after themselves.')
  await pause(page, 8)
  // Cut here: the browser shutting down afterwards would only add a still frame.
  await fs.writeFile(path.join(process.cwd(), 'test-results', 'walkthrough-end.txt'), String((Date.now() - (page as any).t0) / 1000))
})
