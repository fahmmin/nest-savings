import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'
import { PASSWORD, VALUECHAIN_TESTNET } from './network.ts'

// The seed comes from e2e/.env (E2E_SEED), only ever on your machine. Rebuild the cache with --force after changing it.
export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const seed = process.env.E2E_SEED
  if (!seed) throw new Error('Set E2E_SEED in e2e/.env to the seed of your whitelisted, funded SoDEX testnet wallet')
  const metamask = new MetaMask(context, walletPage, PASSWORD)
  await metamask.importWallet(seed)
  await metamask.addNetwork(VALUECHAIN_TESTNET)
  await metamask.switchNetwork(VALUECHAIN_TESTNET.name)
})
