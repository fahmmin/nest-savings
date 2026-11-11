import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASKETS, basketById } from '../src/baskets.ts'
import { targetWeights } from '../src/weights.ts'
import { CASH } from '../src/types.ts'
import type { Signal } from '../src/types.ts'

const sig = (symbol: string, tilt: number): Signal => ({ id: symbol, symbol, tilt, text: '', source: { label: '', url: '' }, asOf: '' })
const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0)

test('every basket sums to 100 and is found by id', () => {
  for (const b of BASKETS) {
    assert.equal(sum(b.weights), 100, b.id)
    assert.equal(basketById(b.id), b)
  }
  assert.equal(basketById('nope'), undefined)
})

test('no signals: target equals base weights', () => {
  const b = basketById('balanced')!
  assert.deepEqual(targetWeights(b, []), b.weights)
})

test('BTC tilt +1 adds 5 points before renormalising', () => {
  const t = targetWeights(basketById('steady')!, [sig('vBTC_vUSDC', 1)])
  // 60/30/15 over 105
  assert.equal(t['vBTC_vUSDC'], 28.6)
  assert.equal(t[CASH], 57.1)
  assert.equal(t['vNVDA_vUSDC'], 14.3)
})

test('signals for assets not in the basket are ignored (CASH tilt only if CASH is in it)', () => {
  const growth = basketById('growth')!
  assert.deepEqual(targetWeights(growth, [sig(CASH, 1)]), growth.weights)
  const crypto = basketById('crypto')!
  assert.deepEqual(targetWeights(crypto, [sig('vNVDA_vUSDC', -1)]), crypto.weights)
})

test('tilts are clamped to ±1 and weights floor at 0', () => {
  const t = targetWeights(basketById('steady')!, [sig('vBTC_vUSDC', 50)])
  assert.equal(t['vBTC_vUSDC'], 28.6)
  const b = { ...basketById('steady')!, weights: { [CASH]: 97, vBTC_vUSDC: 3 } }
  const t2 = targetWeights(b, [sig('vBTC_vUSDC', -1)])
  assert.equal(t2['vBTC_vUSDC'], 0)
  assert.equal(t2[CASH], 100)
})

test('targets sum to ~100 after rounding', () => {
  const t = targetWeights(basketById('balanced')!, [sig('vBTC_vUSDC', 0.41), sig('vDEFIssi_vUSDC', -0.3), sig(CASH, 1)])
  assert.ok(Math.abs(sum(t) - 100) < 0.2, String(sum(t)))
})
