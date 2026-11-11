// Builds the Synpress wallet cache (.cache-synpress/<hash>) on any OS, Windows included.
// The official CLI (`npm run cache:cli`) stops on win32 with "Sorry, Windows is currently not supported.
// Please use WSL instead!" (cliEntrypoint in @synthetixio/synpress-cache). The test fixtures have no such
// check, so this does what the CLI's createCacheForWalletSetupFunction does, with Synpress's own pieces.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { CACHE_DIR_NAME, prepareExtension } from '@synthetixio/synpress-cache'
// Which wallet setup to cache comes from argv: the test mnemonic by default, or your own wallet for the live run.
const setup = (await import(pathToFileURL(path.resolve(process.argv[2] ?? "wallet-setup/test.setup.ts")).href)).default

const dir = path.join(process.cwd(), CACHE_DIR_NAME, setup.hash)
if (fs.existsSync(dir) && !process.argv.includes('--force')) {
  console.log(`Cache ${setup.hash} already exists. Pass --force to rebuild it.`)
  process.exit(0)
}
fs.rmSync(dir, { recursive: true, force: true })

const extension = await prepareExtension() // MetaMask release zip from GitHub, downloaded once into .cache-synpress
const context = await chromium.launchPersistentContext(dir, {
  headless: false, // Synpress passes --headless=new instead, extensions need it
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, ...(process.env.HEADLESS ? ['--headless=new'] : [])],
})
const isMetaMask = (p: { url(): string }) => p.url().startsWith('chrome-extension://')
try {
  const walletPage = context.pages().find(isMetaMask) ?? (await context.waitForEvent('page', { predicate: isMetaMask, timeout: 30_000 }))
  await walletPage.locator('#app-content .app').waitFor({ timeout: 30_000 })
  await setup.fn(context, walletPage)
  await walletPage.waitForTimeout(3000) // same pause as the CLI, so the profile is flushed to disk
} catch (e) {
  await context.close()
  fs.rmSync(dir, { recursive: true, force: true }) // never leave a half-built cache that the next run would skip
  throw e
}
await context.close()
console.log(`Wallet cache ready: ${dir}`)
