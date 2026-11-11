import { defineChain } from 'viem'

export const AGENT_URL = ((import.meta.env.VITE_AGENT_URL as string | undefined) || 'http://localhost:8790').replace(/\/$/, '')

export const SODEX_GW = 'https://testnet-gw.sodex.dev/api/v1'
export const SODEX_APP = 'https://testnet.sodex.com'
export const SODEX_ONBOARDING = 'https://docs.sodex.com/resources/testnet-onboarding-steps'
export const EXPLORER = 'https://test-scan.valuechain.xyz'

/** ValueChain testnet: SoDEX testnet signatures use this chain id in their EIP-712 domain. */
export const valuechainTestnet = defineChain({
  id: 138565,
  name: 'ValueChain Testnet',
  nativeCurrency: { name: 'SOSO', symbol: 'SOSO', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet.valuechain.xyz'] } },
  blockExplorers: { default: { name: 'test-scan', url: EXPLORER } },
  testnet: true,
})

export const apiKeysUrl = (addr: string) => `${SODEX_GW}/user/${addr}/api-keys`
