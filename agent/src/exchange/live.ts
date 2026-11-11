// Exchange on SoDEX testnet, trading with the user's per-user permissioned API key.
import type { LocalAccount } from 'viem'
import type { Address, Exchange, Fill } from '../types.ts'
import * as sodex from '../sodex/client.ts'

export type GetApiKey = (address: Address) => { name: string; account: LocalAccount } | Promise<{ name: string; account: LocalAccount }>

export function liveExchange(getApiKey: GetApiKey): Exchange {
  return {
    filters: sodex.filters,
    books: sodex.books,
    balances: user => sodex.balances(user.address, user.accountId),
    async place(user, orders) {
      const key = await getApiKey(user.address)
      const fills: Fill[] = []
      // One order per request, awaited, so a sell's proceeds are settled before the next buy.
      for (const o of orders) {
        try {
          fills.push(...await sodex.batchNewOrder(user, [o], key.account, key.name))
        } catch (e) {
          fills.push({ order: o, status: 'rejected', filledQty: 0, avgPrice: 0, error: (e as Error).message })
        }
      }
      return fills
    },
  }
}
