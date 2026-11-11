import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getSignals, newsFor, signalsFrom, topNews, usdShort } from '../src/signals.ts'
import type { EtfDay } from '../src/soso.ts'
import { CASH } from '../src/types.ts'

delete process.env.SOSO_API_KEY
const fx = (n: string) => JSON.parse(readFileSync(new URL(`../fixtures/soso/${n}.json`, import.meta.url), 'utf8'))

test('fixtures are marked as fixtures', () => {
  for (const n of ['etf-btc', 'etf-eth', 'fgi', 'news']) assert.equal(fx(n)._fixture, true)
})

test('from fixtures: unsettled newest row skipped, 5 settled days summed', async () => {
  const s = await getSignals()
  const btc = s.find((x) => x.id === 'btc-etf-flow')!
  assert.equal(btc.symbol, 'vBTC_vUSDC')
  assert.equal(btc.tilt, 0.41) // 120 - 35 + 210 + 47 + 70 = 412M over $1B
  assert.equal(btc.text, 'Big funds put $412M into Bitcoin ETFs over the last 5 days.')
  assert.equal(btc.asOf, '2026-11-10')
  assert.match(btc.source.url, /^https:\/\/sosovalue\.com\//)
  const eth = s.find((x) => x.id === 'eth-etf-flow')!
  assert.equal(eth.symbol, 'vDEFIssi_vUSDC')
  assert.equal(eth.tilt, -0.3) // -90M over $300M
  assert.match(eth.text, /pulled \$90M out of Ethereum ETFs/)
  const fgi = s.find((x) => x.id === 'fear-greed')!
  assert.equal(fgi.symbol, CASH)
  assert.equal(fgi.tilt, 1) // 78 > 75; newest row lacks the key
  assert.equal(fgi.asOf, '2026-11-10')
})

test('tilts are clamped to [-1, 1]', () => {
  const day = (date: string, v: number | null): EtfDay => ({ date, total_net_inflow: v, total_value_traded: 0, total_net_assets: 0, cum_net_inflow: 0 })
  const big = [day('2026-11-05', 2e9), day('2026-11-04', 1e9)]
  const s = signalsFrom({ btc: big, eth: big.map((d) => ({ ...d, total_net_inflow: -(d.total_net_inflow as number) })), fgi: [{ timestamp: '0', 'crypto_fear_&_greed_index': 10 }] })
  assert.equal(s[0].tilt, 1)
  assert.equal(s[0].text, 'Big funds put $3B into Bitcoin ETFs over the last 2 days.')
  assert.equal(s[1].tilt, -1)
  assert.equal(s[2].tilt, -0.5)
})

test('neutral fear & greed gives tilt 0; missing series gives no signal', () => {
  assert.equal(signalsFrom({ btc: [], eth: [], fgi: [{ timestamp: '0', 'crypto_fear_&_greed_index': 50 }] })[2].tilt, 0)
  assert.equal(signalsFrom({ btc: [], eth: [], fgi: [{ timestamp: '0' }] }).length, 2)
})

test('usdShort', () => {
  assert.equal(usdShort(412e6), '$412M')
  assert.equal(usdShort(-1.25e9), '$1.3B')
})

test('topNews picks the newest titled item per asset', async () => {
  assert.match((await topNews('vBTC_vUSDC'))!.label, /fourth day of inflows/)
  assert.match((await topNews('vNVDA_vUSDC'))!.label, /Nvidia/)
  assert.match((await topNews('vDEFIssi_vUSDC'))!.label, /Ethereum/)
  assert.equal(newsFor('vUSDC', []), undefined)
})
