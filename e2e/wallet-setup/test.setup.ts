import { defineWalletSetup } from '@synthetixio/synpress'
import { MetaMask } from '@synthetixio/synpress/playwright'
import { PASSWORD, VALUECHAIN_TESTNET } from './network.ts'

// Anvil's public test mnemonic only (account #0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266). Never a real key.
export const SEED_PHRASE = 'test test test test test test test test test test test junk'

export default defineWalletSetup(PASSWORD, async (context, walletPage) => {
  const metamask = new MetaMask(context, walletPage, PASSWORD)
  await metamask.importWallet(SEED_PHRASE)
  await metamask.addNetwork(VALUECHAIN_TESTNET)
  await metamask.switchNetwork(VALUECHAIN_TESTNET.name)
})
