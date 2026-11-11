// Builds the exact settings message from docs/api.md. Pure, unit tested.
//   Nest settings\naddress:<a>\nnonce:<ms>\n<json of rules+status>
// Matches agent/src/server.ts: the JSON is { rules, status? }; the agent checksums the address before comparing, and
// an empty cashOutAt clears the cash-out date.
import type { Address, UserRules, UserStatus } from './types.ts'

export type SettingsChange = { rules: Partial<UserRules>; status?: Extract<UserStatus, 'active' | 'paused'> }

export function settingsMessage(address: Address, nonce: number, change: SettingsChange): string {
  const body = change.status ? { rules: change.rules, status: change.status } : { rules: change.rules }
  return `Nest settings\naddress:${address.toLowerCase()}\nnonce:${nonce}\n${JSON.stringify(body)}`
}

/** Body for POST /users/:address/settings. */
export const settingsBody = (change: SettingsChange, message: string, signature: string) => ({
  rules: change.rules,
  ...(change.status ? { status: change.status } : {}),
  message,
  signature,
})
