import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256, stringToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { canonicalJson, journalDigest, verifyEntry } from '../src/journal.ts'
import { settingsBody, settingsMessage } from '../src/settings.ts'
import { assetName, floorExample, floorValue, fmtSignedUsd, fmtUsd } from '../src/format.ts'
import type { LogEntry } from '../src/types.ts'

test('fmtUsd and friends', () => {
  assert.equal(fmtUsd(1234.5), '$1,234.50')
  assert.equal(fmtUsd(-4), '-$4.00')
  assert.equal(fmtUsd(25_000), '$25,000')
  assert.equal(fmtSignedUsd(12.3), '+$12.30')
  assert.equal(fmtSignedUsd(-1), '-$1.00')
  assert.equal(assetName('vBTC_vUSDC'), 'Bitcoin')
  assert.equal(assetName('vUSDC'), 'Dollars')
  assert.equal(assetName('vXYZ_vUSDC'), 'vXYZ')
})

test('floor example matches the onboarding copy', () => {
  assert.equal(floorValue(1000, 15), 850)
  assert.equal(floorExample(15), 'If $1,000 falls to $850, Nest moves you to dollars.')
  assert.equal(floorExample(50), 'If $1,000 falls to $500, Nest moves you to dollars.')
})

test('canonicalJson sorts keys at every level and drops undefined', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[{"y":2,"z":1}]},"b":1}')
  assert.equal(canonicalJson([undefined, 'x']), '[null,"x"]')
})

test('journal digest round trip: signed entry verifies, edited entry does not', async () => {
  const key = privateKeyToAccount(keccak256(stringToBytes('test-journal')))
  const unsigned = { id: 1, ts: '2026-11-11T00:00:00.000Z', address: '0x5afe000000000000000000000000000000000001', kind: 'hold', text: 'No change needed.', sources: [], fills: [], valueUsd: 1000, signer: key.address } as Omit<LogEntry, 'signature'>
  assert.equal(journalDigest(unsigned), keccak256(stringToBytes(canonicalJson(unsigned))))
  const entry = { ...unsigned, signature: await key.signMessage({ message: { raw: journalDigest(unsigned) } }) } as LogEntry
  assert.equal(await verifyEntry(entry, key.address), 'verified')
  assert.equal(await verifyEntry({ ...entry, valueUsd: 2000 }, key.address), 'wrong-signer')
  assert.equal(await verifyEntry({ ...entry, signature: '0x1234' }, key.address), 'invalid')
})

test('settings message follows docs/api.md and the agent parser', () => {
  const m = settingsMessage('0x5aFE000000000000000000000000000000000001', 1762819200000, { rules: { floorPct: 20 }, status: 'paused' })
  assert.equal(m, 'Nest settings\naddress:0x5afe000000000000000000000000000000000001\nnonce:1762819200000\n{"rules":{"floorPct":20},"status":"paused"}')
  const parsed = /^Nest settings\naddress:(0x[0-9a-fA-F]{40})\nnonce:(\d+)\n([\s\S]+)$/.exec(m)!
  assert.deepEqual(JSON.parse(parsed[3]), { rules: { floorPct: 20 }, status: 'paused' })
  assert.equal(settingsMessage('0x5afe000000000000000000000000000000000001', 1, { rules: { cashOutAt: '' } }).split('\n')[3], '{"rules":{"cashOutAt":""}}')
  assert.deepEqual(settingsBody({ rules: { basketId: 'steady' } }, 'm', '0xsig'), { rules: { basketId: 'steady' }, message: 'm', signature: '0xsig' })
})
