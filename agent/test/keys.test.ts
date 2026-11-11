import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.NODE_ENV = 'test'
delete process.env.ROOT_SECRET
const { apiKeyFor, inEnclave, journalAccount } = await import('../src/keys.ts')

const A = '0xAbCdEf0123456789abcdef0123456789ABCDEF01'
const B = '0x2222222222222222222222222222222222222222'

test('deterministic per address, case-insensitive', () => {
  assert.equal(apiKeyFor(A).publicKey, apiKeyFor(A.toLowerCase() as `0x${string}`).publicKey)
  assert.equal(apiKeyFor(A).account.address, apiKeyFor(A).publicKey)
})

test('different per address and from the journal key', () => {
  assert.notEqual(apiKeyFor(A).publicKey, apiKeyFor(B).publicKey)
  assert.notEqual(apiKeyFor(A).publicKey, journalAccount().address)
})

test('name is nest- + first 8 hex chars and fits SoDEX rules', () => {
  assert.equal(apiKeyFor(A).name, 'nest-abcdef01')
  assert.match(apiKeyFor(A).name, /^[0-9a-zA-Z_-]{1,36}$/)
})

test('bad address throws; not in an enclave here', () => {
  assert.throws(() => apiKeyFor('0x123' as `0x${string}`))
  assert.equal(inEnclave(), false)
})

test('ROOT_SECRET changes the keys; a short one is refused', () => {
  const before = apiKeyFor(A).publicKey
  process.env.ROOT_SECRET = 'another-root-secret-123'
  try {
    assert.notEqual(apiKeyFor(A).publicKey, before)
    process.env.ROOT_SECRET = 'short'
    assert.throws(() => apiKeyFor(A), /at least 16/)
  } finally {
    delete process.env.ROOT_SECRET
  }
})

test('outside tests, a missing ROOT_SECRET is a clear error', () => {
  process.env.NODE_ENV = 'production'
  try {
    assert.throws(() => apiKeyFor(A), /ROOT_SECRET is not set/)
  } finally {
    process.env.NODE_ENV = 'test'
  }
})
