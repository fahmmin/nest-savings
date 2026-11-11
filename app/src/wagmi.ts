import { createConfig, http, injected } from 'wagmi'
import { valuechainTestnet } from './config'

// The app never sends transactions; the wallet only signs messages. switchChain adds the chain to the wallet when missing.
export const wagmiConfig = createConfig({
  chains: [valuechainTestnet],
  connectors: [injected()],
  multiInjectedProviderDiscovery: false,
  transports: { [valuechainTestnet.id]: http() },
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
