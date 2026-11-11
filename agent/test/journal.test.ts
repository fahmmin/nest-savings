import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.NODE_ENV = 'test'
const { canonicalJson, signEntry, verifyEntry } = await import('../src/journal.ts')
const { journalAccount } = await import('../src/keys.ts')

const entry = {
  id: 1, ts: '2026-11-11T12:00:00Z', address: '0x1111111111111111111111111111111111111111' as const, kind: 'rebalance' as const,
  text: 'Bitcoin grew to 31% of your basket (target 25%); selling Bitcoin for dollars.',
  sources: [{ label: 'SoSoValue', url: 'https://sosovalue.com/' }], fills: [], valueUsd: 1000,
}

test('canonicalJson sorts keys at every level and drops undefined', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[1,{"y":2,"z":1}]},"b":1}')
})

test('sign then verify is true; signer is the journal key', async () => {
  const s = await signEntry(entry)
  assert.equal(s.signer, journalAccount().address)
  assert.equal(await verifyEntry(s), true)
})

test('any tamper makes verify false', async () => {
  const s = await signEntry(entry)
  assert.equal(await verifyEntry({ ...s, valueUsd: 1001 }), false)
  assert.equal(await verifyEntry({ ...s, text: s.text + '!' }), false)
  assert.equal(await verifyEntry({ ...s, signer: '0x2222222222222222222222222222222222222222' }), false)
})
