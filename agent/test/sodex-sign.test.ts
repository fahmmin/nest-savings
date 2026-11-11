import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hashTypedData, keccak256, toHex, recoverTypedDataAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  permissionedKeyTypedData, permissionedKeyBody, toTypedSignature, canonicalDecimal,
  batchNewOrderParams, payloadHash, signExchangeAction, AGENT_PERMISSIONS,
} from '../src/sodex/sign.ts'

// Python SDK tests/test_api_keys.py fixtures.
const MASTER = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123')
const PUBKEY = '0x3d4595c8742d0a58173a9963c05755b59a8f8256'
const NONCE = 1760373925000

test('UserSignedAddPermissionedAPIKeyAction matches the Python SDK golden vector byte for byte', async () => {
  const args = { accountId: 1010, name: 'api-key-01', publicKey: PUBKEY as Hex, expiresAt: 0, permissions: 3, nonce: NONCE, chainId: 286623 }
  const sig = await MASTER.signTypedData(permissionedKeyTypedData(args) as any)
  assert.equal(toTypedSignature(sig, '0x02'),
    '0x02ce43d9c70b104dab304eea275f977d3adfac035c6705374db783bdbc84a7f2' +
    '9902b099ba25c508f3da08e0f606efac67a30310c1bf617232d093161a93f2f9a000')
  assert.equal(JSON.stringify(permissionedKeyBody(args)),
    `{"accountID":1010,"name":"api-key-01","type":1,"publicKey":"${PUBKEY}","expiresAt":0,"permissions":3}`)
})

test('permissioned typed data survives a JSON round trip (what the app wallet receives)', async () => {
  const td = permissionedKeyTypedData({ accountId: 7, name: 'nest-1', publicKey: PUBKEY as Hex, expiresAt: 1800000000000, permissions: AGENT_PERMISSIONS, nonce: NONCE })
  assert.equal(td.domain.chainId, 138565)
  assert.equal(td.message.chainID, 138565)
  assert.equal(td.message.permissions, 14)
  assert.equal(hashTypedData(JSON.parse(JSON.stringify(td))), hashTypedData(td as any))
  assert.throws(() => permissionedKeyTypedData({ ...td.message, accountId: 7, name: 'default', publicKey: PUBKEY as Hex, nonce: 1 }))
})

test('toTypedSignature normalises v 27/28 to 0/1 and leaves 0/1 alone', () => {
  const rs = 'ab'.repeat(64)
  assert.equal(toTypedSignature(`0x${rs}1b`, '0x01'), `0x01${rs}00`)
  assert.equal(toTypedSignature(`0x${rs}1c`, '0x02'), `0x02${rs}01`)
  assert.equal(toTypedSignature(`0x${rs}01`, '0x01'), `0x01${rs}01`)
  assert.throws(() => toTypedSignature(`0x${rs}05`, '0x01'))
  assert.throws(() => toTypedSignature(`0x${rs}`, '0x01'))
})

test('canonicalDecimal matches shopspring/decimal String()', () => {
  const cases: [string | number, string][] = [
    ['0.50', '0.5'], ['1.0', '1'], ['100', '100'], ['0', '0'], ['0.000', '0'], ['-0', '0'], ['007.10', '7.1'],
    ['1e-5', '0.00001'], ['1E3', '1000'], ['1.5e3', '1500'], ['1e-18', '0.000000000000000001'], ['.5', '0.5'],
    ['-0.50', '-0.5'], ['73763', '73763'], [0.00001, '0.00001'], [1e21, '1000000000000000000000'], [182.27, '182.27'],
    // Go SDK TestDcaCanonicalDecimals
    ['9007199254740993.123456789012345678900', '9007199254740993.1234567890123456789'],
  ]
  for (const [i, o] of cases) assert.equal(canonicalDecimal(i), o, String(i))
  for (const bad of ['', '.', 'abc', '1.2.3', '0x10', NaN]) assert.throws(() => canonicalDecimal(bad as string), String(bad))
})

// Go SDK common/signer/testdata/dca_nova_vectors.json: key 0x…01, nonce 123. Pins the whole
// ExchangeAction pipeline (payload JSON → keccak → EIP-712 → 0x01 wire format) byte for byte.
test('ExchangeAction signatures match the Go SDK golden vectors', async () => {
  const key = privateKeyToAccount(`0x${'0'.repeat(63)}1`)
  const vectors = JSON.parse(readFileSync(new URL('../fixtures/sodex/go-sdk-dca-vectors.json', import.meta.url), 'utf8'))
  let signed = 0
  for (const v of vectors) {
    assert.equal(payloadHash(v.action, v.request), `0x${v.hash}`)
    if (!v.signature) continue
    const r = await signExchangeAction(key, v.action, JSON.parse(v.request), 123, { chainId: v.chainID, domain: v.domain })
    assert.equal(r.body, v.request)
    assert.equal(r.payloadHash, `0x${v.hash}`)
    assert.equal(r.signature, `0x${v.signature}`)
    signed++
  }
  assert.equal(signed, 20)
})

test('batchNewOrder params: Go struct key order, canonical decimals, omitted optionals', async () => {
  const params = batchNewOrderParams(1010, [
    { symbolID: 1, clOrdID: 'n-abc_1', side: 1, type: 1, timeInForce: 3, price: '74131.50', quantity: '0.00010' },
    { quantity: '1e-2', funds: undefined, price: undefined, timeInForce: 3, type: 2, side: 2, clOrdID: 'm2', symbolID: 27 },
  ])
  const body = JSON.stringify(params)
  assert.equal(body,
    '{"accountID":1010,"orders":[' +
    '{"symbolID":1,"clOrdID":"n-abc_1","side":1,"type":1,"timeInForce":3,"price":"74131.5","quantity":"0.0001"},' +
    '{"symbolID":27,"clOrdID":"m2","side":2,"type":2,"timeInForce":3,"quantity":"0.01"}]}')
  const key = privateKeyToAccount(`0x${'0'.repeat(63)}1`)
  const r = await signExchangeAction(key, 'batchNewOrder', params, 1760373925000n)
  assert.equal(r.body, body)
  assert.equal(r.payloadHash, keccak256(toHex(`{"type":"batchNewOrder","params":${body}}`)))
  // Self-generated regression pin (no upstream batchNewOrder vector exists); recomputed from the pipeline above.
  assert.equal(r.payloadHash, '0xfbb56cc837147162be754922e42a35fe214ae4e7ed4dcfb769206c16ca115df9')
  assert.equal(r.signature, '0x01eee80ab5caa4d2a6110b691ca82f64480e155839ba28bab1741c52b2ec1ec04652b87b85d7629016338aa63778282182d797c2781244df88b90a62db52f1969600')
  assert.equal(r.signature.slice(0, 4), '0x01')
  const recovered = await recoverTypedDataAddress({
    domain: { name: 'spot', version: '1', chainId: 138565, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: { ExchangeAction: [{ name: 'payloadHash', type: 'bytes32' }, { name: 'nonce', type: 'uint64' }] },
    primaryType: 'ExchangeAction', message: { payloadHash: r.payloadHash, nonce: 1760373925000n },
    signature: `0x${r.signature.slice(4, -2)}${r.signature.endsWith('00') ? '1b' : '1c'}`,
  })
  assert.equal(recovered, key.address)
  assert.throws(() => batchNewOrderParams(1, [{ symbolID: 1, clOrdID: 'bad id!', side: 1, type: 1, timeInForce: 3 }]))
  assert.throws(() => batchNewOrderParams(1, []))
})
