# SoDEX Testnet: Spot Trading from Node/TypeScript

Researched 2026-11-11. Sources: https://docs.sodex.com (`.md` pages + `llms-full.txt`), the official Python SDK (`sodex-tech/sodex-python-sdk-public`), the official Go SDK (`sodex-tech/sodex-go-sdk-public`), the testnet web app bundle (`testnet.sodex.com`), and live read-only GETs against `https://testnet-gw.sodex.dev`.

Legend: **[doc]** stated in the docs, **[sdk]** from SDK source, **[live]** checked against testnet, **[unverified]** inferred and not tested.

---

## 0. TL;DR

| Item | Value |
|---|---|
| REST base (testnet) | `https://testnet-gw.sodex.dev/api/v1` (public/user), `/api/v1/spot`, `/api/v1/perps` |
| WebSocket (testnet) | `wss://testnet-gw.sodex.dev/ws/spot`, `wss://testnet-gw.sodex.dev/ws/perps` |
| Chain ID | `138565` (verified: `eth_chainId` on the testnet RPC returns `0x21d45`) **[live]** |
| ValueChain testnet RPC / explorer | `https://testnet.valuechain.xyz` / `https://test-scan.valuechain.xyz`. Gas token: native SOSO, 18 decimals |
| ClobGateway (EVM→Spot deposit) | `0x0101010101010101010101010101010101010101` (same on mainnet and testnet) |
| Quote asset | `vUSDC` (coin id `0`, precision 6). Every spot symbol is `X_vUSDC` |
| Official TS/JS SDK | **None public.** The `sodex-tech` GitHub org has only the Go and Python SDKs (plus `lucky-draw`). Nothing on npm. The Python tests mention a "TypeScript SDK golden vector", so an internal one probably exists. Use viem directly (snippets below are verified against the SDK vectors). |
| Sign key registration | EIP-712 domain `universal`, signature prefix **`0x02`**, signed by the master wallet |
| Sign trading actions (orders, cancels, TWAP, transfers) | EIP-712 domain **`spot`**, type `ExchangeAction{payloadHash,nonce}`, prefix **`0x01`** (not 0x02) |
| Spot order action name | **`batchNewOrder`** (the generic docs say `newOrder`, but spot code and examples use `batchNewOrder`). Endpoint: `POST /spot/trade/orders/batch` |

---

## 1. Testnet onboarding

### 1.1 Getting test funds (faucet)
- **[doc]** Testnet onboarding steps (https://docs.sodex.com/resources/testnet-onboarding-steps): connect the **whitelisted** wallet → accept Terms → **Claim Test Tokens** → add the ValueChain network → **transfer the test tokens from the "EVM-Funding Account" to your Spot account** (wallet approves it) → enable gas-free trading → place an order.
- **[live, from the web bundle]** The faucet is the `/faucet` page on `https://testnet.sodex.com` (`FaucetPage-*.js`). It calls:
  - `POST faucet/api/check-whitelist {address, email?}` → `{inWhitelist, inAnotherWhitelist, claimStatus (0 notClaimed|1 claiming|2 claimed|3 failed), claimCount}`
  - `POST biz/task/referral/join {referralCode, walletAddress, email?}` (+ JWT): joins the whitelist with an **invite code**
  - `POST faucet/api/claim {address, email?}` → returns an EVM tx hash. The UI waits for 3 confirmations, then refreshes EVM balances and the spot/perps account state.
  - The UI shows separate strings for the **first claim amount** and the **daily amount**, so you can claim again every day. Error codes: 1 = claim rejected, 2 = server busy.
- **Funding is gated by a whitelist or invite code and goes through the web UI's login (Privy/wallet).** There is no public, unauthenticated faucet API for a backend. The exact token amounts and token list are **[unverified]** (strings are loaded from locale JSON I could not fetch). Expect test USDC, plus native SOSO for gas. One activated testnet account I looked at held `1400 vUSDC`.
- **[doc]** There is **no testnet Mirror API** (external custody/bridge deposits are mainnet-only). `GET https://testnet-gw.sodex.dev/api/v1/asset/config` returns `{"code":-1,"error":"deposit and withdrawal disable list is unavailable"}` **[live]**.

### 1.2 EVM wallet → SoDEX account
- An account exists once the first credit reaches Spot or Perps. **The first credit must be USDC or SOSO, and activation costs 1 unit (1 USDC or 1 SOSO)** **[doc]**. On mainnet the key-registration step also requires a single deposit of ≥ 5 USDC. On testnet the docs only say "activate and fund your testnet trading account".
- From EVM to Spot: use the UI "transfer" (step 5 above), or call ClobGateway yourself from the master wallet, paying SOSO gas:
  - ERC-20: `approve(0x0101…01, amount)` then `depositERC20(address token, uint256 amount)`. This credits the caller's **Spot** account.
  - Native SOSO: `depositERC20(0x000…000, amount)` with `msg.value = amount`.
  - Perps overload: `depositERC20(token, amount, recipient, 1)`.
  - The testnet ERC-20 address for test USDC is **[unverified]**: the asset-config API is mainnet-only, so read it from the explorer or the faucet tx.
  - A receipt with `success` does **not** mean the spot balance was credited. Poll the spot balances afterwards.
- **Account ID discovery** **[live]** (all of these are public GETs and need no auth):
  - `GET /api/v1/user/{addr}/status` → `{"status":"Active","userID":46032}` or `{"status":"UserNotFound"}`
  - `GET /api/v1/user/{addr}/subaccounts` → `{"userID","primaryAccountID","subaccounts":[{"id","evmAddress"}]}`. An unknown user gets `{"code":-1,"error":"user not found"}`.
  - `GET /api/v1/spot/accounts/{addr}/state` → `data.aid` is the accountID. For an unknown user it returns `code:0` with `aid:0` and an all-zero `user`, so **treat `aid==0` as "not activated"**.
- **Sub-accounts:** listing is documented (`/user/{addr}/subaccounts`, plus `?accountID=` on every account query). **No create-sub-account API is documented** in the REST reference or either SDK. It is presumably UI-only **[unverified]**. Every sub-account has its own `evmAddress`. One master account can hold at most 5 API keys, which can sign for the master or any of its sub-accounts.

---

## 2. Signing

### 2.1 Common rules
- EIP-712 domain fields are always `{name, version:"1", chainId, verifyingContract: 0x0000000000000000000000000000000000000000}`.
- **Recovery byte:** viem returns `v = 27/28`. The Go and Python SDKs emit **`v = 0/1`**, and the docs' addAPIKey example normalizes it. Always normalize to 0/1. The wire signature is 66 bytes: `typeByte ‖ r ‖ s ‖ v`.
- **Nonces [doc]:** the `X-API-Nonce` header is a uint64. Use the current Unix time in ms. The engine stores the **100 highest nonces per signing address**. A new nonce must be **greater than the smallest of those 100 and never used before**, and must fall inside `(blockTime − 2 days, blockTime + 1 day)`. Nonces are tracked **per signer address**: the API key's address for trading, and the master's address for key registration. Two sub-accounts that share one API key share one nonce stream, so use one key per concurrent process. A strictly increasing `max(Date.now(), last+1)` counter per signer is enough.
- **Responses:** errors come back as **HTTP 200** with `{"code":-1,"timestamp":…,"error":"…"}` **[live]**. Always check `code`. Examples seen: `"symbol not found"`, `"X-API-Nonce is required in header"`, `"nonce is invalid"` (docs).

### 2.2 addPermissionedAPIKey (master wallet, universal domain, `0x02`)
- `POST /api/v1/user/{masterAddress}/api-keys`
- Headers: `Content-Type: application/json`, `Accept: application/json`, `X-API-Chain: 138565` (**required here**, and it must equal `domain.chainId`), `X-API-Nonce: <nonce>`, `X-API-Sign: 0x02…`. Do not send `X-API-Key`.
- Body (`AddPermissionedAPIKeyRequest`, in Go struct order): `{"accountID":<u64>,"name":"<^[0-9a-zA-Z_-]{1,36}$, not 'default'>","type":1,"publicKey":"<API-key EVM address>","expiresAt":<ms>,"permissions":<u64 mask>}`. The nonce goes **only** in the header and the signed message, never the body. The body calls the key type `type`, but the typed data calls it `keyType`.
- Typed data:
  ```
  primaryType: UserSignedAddPermissionedAPIKeyAction
  UserSignedAddPermissionedAPIKeyAction(uint64 chainID,uint64 nonce,uint64 accountID,string name,uint8 keyType,bytes publicKey,uint64 expiresAt,uint64 permissions)
  message.chainID = 138565 (in addition to domain.chainId), keyType = 1, publicKey = the 20-byte address passed as `bytes`
  ```
- Ordinary key, without `permissions`: primaryType `AddAPIKey(uint64 accountID,string name,uint8 keyType,bytes publicKey,uint64 expiresAt,uint64 nonce)`. It has **no** chainID field and the nonce comes last. You cannot combine `builder` and `permissions` in one request.
- Registration lands on **both** the spot and perps engines and succeeds only if both accept it. Confirm with the GET in §4 before trading, because the index can lag.
- `expiresAt`: a timestamp in ms. The docs example uses `now + 24h`. The schema examples and the `default` key use `0`, which probably means "never expires" **[unverified]**. Set an explicit expiry.

### 2.3 Spot trading actions (API key, `spot` domain, `0x01`)
1. `params` = the HTTP body object. Keys must be **in Go struct field order**, decimals must be **quoted strings in canonical form** (no trailing zeros, no exponent: `"0.5"`, not `"0.50"`), and unset optional fields must be **omitted**.
2. `payloadHash = keccak256(utf8(JSON.stringify({type: <actionName>, params})))`. Use compact JSON with no spaces.
3. Sign `ExchangeAction{bytes32 payloadHash, uint64 nonce}` under domain `{name:"spot", version:"1", chainId:138565, verifyingContract:0x0…0}` with the **API key's private key**.
4. Headers: `X-API-Key: <key NAME>` (the name, not an address), `X-API-Sign: 0x01<65-byte sig>`, `X-API-Nonce: <nonce>`. The Python SDK also always sends `X-API-Chain`, which is harmless. Send the body as `params` only, byte-identical to what you hashed.
   - To sign with the master wallet directly, **omit** `X-API-Key`. The docs discourage this.

| Action | `type` | Method + path | params (in this exact key order) |
|---|---|---|---|
| Place orders | `batchNewOrder` | `POST /spot/trade/orders/batch` | `{accountID, orders:[{symbolID, clOrdID, side, type, timeInForce, price?, quantity?, funds?}], builder?}` |
| Cancel orders | `batchCancelOrder` | `DELETE /spot/trade/orders/batch` | `{accountID, cancels:[{symbolID, clOrdID, orderID?, origClOrdID?}]}` |
| Replace | `replaceOrder` | `POST /spot/trade/orders/replace` | `{accountID, orders:[{symbolID, clOrdID, origOrderID?, origClOrdID?, price?, quantity?}]}` |
| Dead-man switch | `scheduleCancel` | `POST /spot/trade/orders/schedule-cancel` | `{accountID, scheduledTimestamp?}` (≥ 5 s ahead; max 10 triggers/day) |
| TWAP | `newTwapOrder` | `POST /spot/trade/twaps` | `{accountID, symbolID, side, quantity, minutes, randomize}` |
| Cancel TWAP | `cancelTwapOrder` | `DELETE /spot/trade/twaps` | `{accountID, symbolID, orderID}` |
| DCA plan | `newDcaOrder` | `POST /spot/trade/dcas` | see the docs DCA page; ≥ 10 USDC per execution |
| Transfer out | `transferAsset` | `POST /spot/accounts/transfers` | `{id, fromAccountID, toAccountID, coinID, amount, type}`; for EVM: `toAccountID=999, type=2`; for perps: `toAccountID=999, type=3` |

Enums: side `1=BUY, 2=SELL`. type `1=LIMIT, 2=MARKET`. timeInForce `1=GTC, 2=FOK (not supported), 3=IOC, 4=GTX (post-only)`.

**Market vs limit [doc]:**
- LIMIT: `timeInForce ∈ {GTC, IOC, GTX}`. Send `price` + `quantity` and never `funds`.
- MARKET: `timeInForce` **must be IOC (3)**. Send `quantity` *or* `funds` (quote amount, **market BUY only**), never both. `price` is optional and acts as slippage protection. Without it, the fill is bounded by `lastTradePrice × (1 ± marketDeviationRatio)` (0.1 on testnet).
- An IOC limit order is "limit + timeInForce 3".
- `clOrdID` must match `^[0-9a-zA-Z_-]{1,36}$` and be unique among open orders. At most 100 orders per batch.

Response: `data: [{code, clOrdID, orderID?, error?}]`, one entry per order. A payload-level pre-validation error returns **a single error for the whole batch**, so do not assume `data.length == orders.length`. Acceptance is not a fill: track fills with `/orders`, `/orders/history`, `/trades`, or the WS streams `accountOrderUpdate` and `accountTrade`.

### 2.4 Revoke API key: docs and the Python SDK disagree
- Docs and the Go SDK: revoke separately on each engine. Send `DELETE /api/v1/spot/accounts/api-keys` signed `ExchangeAction` under domain `spot` with `0x01`, then the same against `/perps/...` with domain `futures`. Body `{accountID, name}`, type `revokeAPIKey`, **signed by the master wallet**, no `X-API-Key`.
- The Python SDK instead sends `DELETE /api/v1/user/{addr}/api-keys` with a universal `0x02` signature, which the docs say is *not supported*. Follow the docs.

---

## 3. Copy-pasteable TypeScript (viem)

`npm i viem`. I checked the signing functions below in Node 24 + viem 2.21 against the Python SDK's golden vectors. Both `AddAPIKey` and `UserSignedAddPermissionedAPIKeyAction` match byte-for-byte (`0x027b8d…5201` and `0x02ce43…a000` for master key `0x0123…0123`, accountID 1010, nonce 1760373925000, chain 286623). I also checked the `ExchangeAction` digest against a manual EIP-712 construction and confirmed recovery.

```ts
// sodex.ts
import { concatHex, keccak256, toHex, type Hex, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const SODEX = {
  chainId: 138565,
  gw: "https://testnet-gw.sodex.dev/api/v1",
  ws: "wss://testnet-gw.sodex.dev/ws/spot",
} as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

// viem gives v=27/28; SoDEX SDKs emit v=0/1 (golden vectors require it).
function toWire(prefix: "0x01" | "0x02", sig: Hex): Hex {
  const v = parseInt(sig.slice(-2), 16);
  return concatHex([prefix, `${sig.slice(0, -2)}${(v >= 27 ? v - 27 : v).toString(16).padStart(2, "0")}` as Hex]);
}

// Strictly increasing ms nonce per signer address (engine keeps the 100 highest per signer).
const last = new Map<string, bigint>();
export function nextNonce(signer: string): bigint {
  const now = BigInt(Date.now());
  const prev = last.get(signer.toLowerCase()) ?? 0n;
  const n = now > prev ? now : prev + 1n;
  last.set(signer.toLowerCase(), n);
  return n;
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${SODEX.gw}${path}`, {
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text(); // shortcut: JSON.parse loses precision on uint64 > 2^53 (orderIDs); use a bigint-safe parser if IDs grow
  const json = JSON.parse(text);
  if (json.code !== 0) throw new Error(`SoDEX ${method} ${path}: code=${json.code} ${json.error ?? text}`);
  return json.data as T;
}

// ---------- permissions ----------
export const PERM = { TRADE: 1, CANCEL: 2, WITHDRAW: 4, TRANSFER: 8 } as const; // a SET bit DISABLES the permission
// Docs: a permissioned key must disable TRADE, CANCEL, or both. "Trade-only, no withdraw/transfer" = 2|4|8 = 14.

// ---------- 1) register a permissioned API key (master wallet) ----------
export async function addPermissionedApiKey(opts: {
  master: LocalAccount; accountID: number; name: string; apiKeyAddress: Hex; expiresAt: number; permissions: number;
}) {
  const { master, accountID, name, apiKeyAddress, expiresAt, permissions } = opts;
  if (!/^[0-9a-zA-Z_-]{1,36}$/.test(name) || name === "default") throw new Error("bad key name");
  const nonce = nextNonce(master.address);
  const sig = await master.signTypedData({
    domain: { name: "universal", version: "1", chainId: SODEX.chainId, verifyingContract: ZERO },
    types: {
      UserSignedAddPermissionedAPIKeyAction: [
        { name: "chainID", type: "uint64" },
        { name: "nonce", type: "uint64" },
        { name: "accountID", type: "uint64" },
        { name: "name", type: "string" },
        { name: "keyType", type: "uint8" },
        { name: "publicKey", type: "bytes" },
        { name: "expiresAt", type: "uint64" },
        { name: "permissions", type: "uint64" },
      ],
    },
    primaryType: "UserSignedAddPermissionedAPIKeyAction",
    message: {
      chainID: BigInt(SODEX.chainId), nonce, accountID: BigInt(accountID), name, keyType: 1,
      publicKey: apiKeyAddress, expiresAt: BigInt(expiresAt), permissions: BigInt(permissions),
    },
  });
  // Body key order mirrors Go AddPermissionedAPIKeyRequest; nonce is NOT in the body.
  return call("POST", `/user/${master.address}/api-keys`,
    { accountID, name, type: 1, publicKey: apiKeyAddress, expiresAt, permissions },
    { "X-API-Chain": String(SODEX.chainId), "X-API-Nonce": nonce.toString(), "X-API-Sign": toWire("0x02", sig) });
}

// ---------- 2) generic spot action (API key) ----------
export async function spotAction<T>(opts: {
  apiKey: LocalAccount; keyName: string; type: string; method: "POST" | "DELETE"; path: string; params: object;
}): Promise<T> {
  const { apiKey, keyName, type, method, path, params } = opts;
  const nonce = nextNonce(apiKey.address);
  const body = JSON.stringify(params); // must be byte-identical to what is hashed
  const payloadHash = keccak256(toHex(`{"type":${JSON.stringify(type)},"params":${body}}`));
  const sig = await apiKey.signTypedData({
    domain: { name: "spot", version: "1", chainId: SODEX.chainId, verifyingContract: ZERO },
    types: { ExchangeAction: [{ name: "payloadHash", type: "bytes32" }, { name: "nonce", type: "uint64" }] },
    primaryType: "ExchangeAction",
    message: { payloadHash, nonce },
  });
  return call<T>(method, `/spot${path}`, body, {
    "X-API-Key": keyName, "X-API-Nonce": nonce.toString(), "X-API-Sign": toWire("0x01", sig),
    "X-API-Chain": String(SODEX.chainId),
  });
}

type OrderResult = { code: number; clOrdID: string; orderID?: number; error?: string };

// Decimals: canonical strings ("0.5", not "0.50"/0.5). Build objects in THIS key order.
export const limitOrder = (symbolID: number, clOrdID: string, side: 1 | 2, price: string, quantity: string, tif: 1 | 3 | 4 = 1) =>
  ({ symbolID, clOrdID, side, type: 1, timeInForce: tif, price, quantity });
export const marketOrder = (symbolID: number, clOrdID: string, side: 1 | 2, size: { quantity: string } | { funds: string }, price?: string) =>
  ({ symbolID, clOrdID, side, type: 2, timeInForce: 3, ...(price ? { price } : {}), ...size }); // funds = quote amount, BUY only

export const placeSpotOrders = (k: LocalAccount, keyName: string, accountID: number, orders: object[]) =>
  spotAction<OrderResult[]>({ apiKey: k, keyName, type: "batchNewOrder", method: "POST", path: "/trade/orders/batch", params: { accountID, orders } });

export const cancelSpotOrders = (k: LocalAccount, keyName: string, accountID: number,
  cancels: { symbolID: number; clOrdID: string; orderID?: number; origClOrdID?: string }[]) =>
  spotAction<OrderResult[]>({ apiKey: k, keyName, type: "batchCancelOrder", method: "DELETE", path: "/trade/orders/batch",
    params: { accountID, cancels: cancels.map(c => ({ symbolID: c.symbolID, clOrdID: c.clOrdID,
      ...(c.orderID !== undefined ? { orderID: c.orderID } : {}), ...(c.origClOrdID ? { origClOrdID: c.origClOrdID } : {}) })) } });

export const newSpotTwap = (k: LocalAccount, keyName: string, p: { accountID: number; symbolID: number; side: 1 | 2; quantity: string; minutes: number; randomize: boolean }) =>
  spotAction<{ orderID: number }>({ apiKey: k, keyName, type: "newTwapOrder", method: "POST", path: "/trade/twaps",
    params: { accountID: p.accountID, symbolID: p.symbolID, side: p.side, quantity: p.quantity, minutes: p.minutes, randomize: p.randomize } });

export const cancelSpotTwap = (k: LocalAccount, keyName: string, accountID: number, symbolID: number, orderID: number) =>
  spotAction<{ orderID: number }>({ apiKey: k, keyName, type: "cancelTwapOrder", method: "DELETE", path: "/trade/twaps", params: { accountID, symbolID, orderID } });

// ---------- 3) public reads ----------
export const getStatus = (addr: string) => call<{ status: "Active" | "UserNotFound"; userID?: number }>("GET", `/user/${addr}/status`);
export const getSubaccounts = (addr: string) => call<{ userID: number; primaryAccountID: number; subaccounts: { id: number; evmAddress: string }[] }>("GET", `/user/${addr}/subaccounts`);
export const getApiKeys = (addr: string, accountID?: number, name?: string) =>
  call<{ spot: ApiKey[]; perps: ApiKey[] }>("GET", `/user/${addr}/api-keys?${new URLSearchParams({ ...(accountID ? { accountID: String(accountID) } : {}), ...(name ? { name } : {}) })}`);
type ApiKey = { name: string; type: "EVM"; publicKey: string; expiresAt: number; permissions?: number };
export const getSpotSymbols = () => call<any[]>("GET", "/spot/markets/symbols");
export const getSpotState = (addr: string, accountID?: number) => call<any>("GET", `/spot/accounts/${addr}/state${accountID ? `?accountID=${accountID}` : ""}`);
export const getOrderBook = (symbol: string, limit = 20) => call<{ bids: [string, string][]; asks: [string, string][] }>("GET", `/spot/markets/${symbol}/orderbook?limit=${limit}`);

// Prove a key's permissions to a user: read them back from the gateway (both engines).
export function describePermissions(mask?: number) {
  const m = mask ?? 0; // field omitted => all permissions enabled (ordinary key)
  return Object.fromEntries(Object.entries(PERM).map(([k, bit]) => [k, (m & bit) === 0]));
}

// ---------- example ----------
// const master = privateKeyToAccount(process.env.MASTER_PK as Hex);
// const apiKey = privateKeyToAccount(process.env.API_KEY_PK as Hex);
// const { primaryAccountID } = await getSubaccounts(master.address);
// await addPermissionedApiKey({ master, accountID: primaryAccountID, name: "bot-1", apiKeyAddress: apiKey.address,
//   expiresAt: Date.now() + 7 * 864e5, permissions: PERM.CANCEL | PERM.WITHDRAW | PERM.TRANSFER /* 14 */ });
// const keys = await getApiKeys(master.address, primaryAccountID, "bot-1"); // check spot[0] AND perps[0], permissions === 14
// await placeSpotOrders(apiKey, "bot-1", primaryAccountID, [limitOrder(1, `o${Date.now()}`, 1, "70000", "0.0001")]); // vBTC_vUSDC, notional 7 ≥ 5
// await placeSpotOrders(apiKey, "bot-1", primaryAccountID, [marketOrder(1, `m${Date.now()}`, 1, { funds: "6" })]);
```

ClobGateway deposit (EVM → Spot) on testnet:

```ts
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Address } from "viem";
export const valuechainTestnet = defineChain({
  id: 138565, name: "ValueChain Testnet",
  nativeCurrency: { name: "SOSO", symbol: "SOSO", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.valuechain.xyz"] } },
  blockExplorers: { default: { name: "test-scan", url: "https://test-scan.valuechain.xyz" } },
});
const GATEWAY = "0x0101010101010101010101010101010101010101";
const abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function depositERC20(address token, uint256 amount)",
]);
export async function depositToSpot(account: any, token: Address, raw: bigint) {
  const pub = createPublicClient({ chain: valuechainTestnet, transport: http() });
  const wal = createWalletClient({ account, chain: valuechainTestnet, transport: http() });
  await pub.waitForTransactionReceipt({ hash: await wal.writeContract({ address: token, abi, functionName: "approve", args: [GATEWAY, raw] }) });
  const hash = await wal.writeContract({ address: GATEWAY, abi, functionName: "depositERC20", args: [token, raw] });
  return pub.waitForTransactionReceipt({ hash }); // success != spot credit; poll /spot/accounts/{addr}/balances
}
```

---

## 4. Public GET endpoints (no auth; spot base `…/api/v1/spot`)

| Purpose | Endpoint | Notes |
|---|---|---|
| Symbols / markets | `GET /markets/symbols` | Every field in §6. **[live]** 33 symbols |
| Coins | `GET /markets/coins` | 56 coins, `{id,name,precision}` |
| Tickers (24h) | `GET /markets/tickers[?symbol=]` | **[live] Returned only 5 symbols, with stale windows (closeTime ~50 days old).** Use bookTickers or orderbook for prices. |
| Mini tickers | `GET /markets/miniTickers` | Same staleness |
| Best bid/ask, all symbols | `GET /markets/bookTickers` | `{symbol,bidPx,bidSz,askPx,askSz}`. `"0"` means that side is empty. **Best price source.** |
| Order book | `GET /markets/{symbol}/orderbook?limit=` | Default 10, max 1000. `bids/asks: [[px,qty]]` |
| Klines | `GET /markets/{symbol}/klines?interval=1h&limit=&startTime=&endTime=` | `{t,o,h,l,c,v,q,n}` |
| Recent trades | `GET /markets/{symbol}/trades?limit=` | `{t,T,s,p,q,S}` |
| Account state | `GET /accounts/{addr}/state[?accountID=]` | `{user,aid,uid,B:[{i,a,t,l}],O:[open orders],TO:[twaps],DO:[dca]}` (`t` = total including locked, `l` = locked) |
| Balances | `GET /accounts/{addr}/balances[?accountID=]` | `{blockTime,blockHeight,balances:[{id,coin,total,locked}]}` |
| Open orders | `GET /accounts/{addr}/orders[?symbol=&accountID=]` | `{orders:[SpotOrder]}` |
| Order history | `GET /accounts/{addr}/orders/history?symbol=&accountID=&startTime=&endTime=&limit=` | Default 50, max 500 |
| Fills | `GET /accounts/{addr}/trades?symbol=&orderID=&accountID=&startTime=&endTime=&limit=` | Default 100, max 1000. Includes `fee`, `feeCoin`, `isMaker` |
| TWAPs | `GET /accounts/{addr}/twaps`, `/twaps/history`, `/twaps/trades` | |
| Fee rate | `GET /accounts/{addr}/fee-rate` | **[live]** maker 0.00035, taker 0.00065 |
| API keys (spot only) | `GET /accounts/{addr}/api-keys[?accountID=&name=]` | `[APIKey]` |
| **API keys (both engines)** | `GET /api/v1/user/{addr}/api-keys[?accountID=&name=]` | `{spot:[APIKey], perps:[APIKey]}`, where `APIKey = {name,type,publicKey,expiresAt,permissions?}` |
| Sub-accounts | `GET /api/v1/user/{addr}/subaccounts` | |
| Status | `GET /api/v1/user/{addr}/status` | `Active` or `UserNotFound` |
| Action quota | `GET /api/v1/user/{addr}/ratelimit` | **[live]** e.g. `transactionQuota 10000`, `cancelQuota 20000` |

**All account data is public by address.** API keys only sign; no auth is needed to read balances, orders, or keys.

### Testnet spot symbols that exist [live, 2026-11-11]
The quote is always **vUSDC** (coin 0). `name` (used in market and WS paths) / `id` (used in signed orders):

| id | name | display | tick | step (=minQty) |
|---|---|---|---|---|
| 1 | vBTC_vUSDC | BTC/USDC | 1 | 0.00001 |
| 2 | vETH_vUSDC | ETH/USDC | 0.1 | 0.0001 |
| 3 | **vMAG7ssi_vUSDC** | MAG7ssi/USDC (coin `vMAG7.ssi`) | 0.0001 | 0.01 |
| 4 | WSOSO_vUSDC | SOSO/USDC (minNotional **1**) | 0.0001 | 0.01 |
| 5 | vLINK_vUSDC | LINK | 0.001 | 0.1 |
| 6 | vSOL_vUSDC | SOL | 0.01 | 0.001 |
| 7 | vDOGE_vUSDC | DOGE | 0.00001 | 1 |
| 8 | vXRP_vUSDC | XRP | 0.0001 | 0.1 |
| 9 | vBNB_vUSDC | BNB | 0.1 | 0.001 |
| 10 | vADA_vUSDC | ADA | 0.00001 | 0.1 |
| 11 | vXAUt_vUSDC | XAUT | 0.1 | 0.0001 |
| 12 | vZEC_vUSDC | ZEC | 0.01 | 0.001 |
| 13 | vLTC_vUSDC | LTC | 0.01 | 0.001 |
| 14 | vSHIB_vUSDC | SHIB | 0.00000001 | 1 |
| 15 | vUNI_vUSDC | UNI | 0.001 | 0.01 |
| 16 | vAAVE_vUSDC | AAVE | 0.01 | 0.001 |
| 17 | vHYPE_vUSDC | HYPE | 0.001 | 0.01 |
| 18 | TESTBTC_vUSDC | TESTBTC | 1 | 0.00001 |
| 19 | TESTSOSO_vUSDC | TESTSOSO | 0.0001 | 0.01 |
| 20 | TESTSHIB_vUSDC | TESTSHIB | 0.00000001 | 1 |
| 21 | vAVAX_vUSDC | AVAX | 0.01 | 0.01 |
| 22 | vDEFIssi_vUSDC | DEFIssi (`vDEFI.ssi`) | 0.0001 | 0.01 |
| 23 | vMEMEssi_vUSDC | MEMEssi (`vMEME.ssi`) | 0.0001 | 0.01 |
| 24 | vUSSI_vUSDC | USSI | 0.0001 | 0.01 |
| 25 | vUSDT_vUSDC | USDT (0 fees) | 0.00001 | 0.01 |
| 26 | vTSLA_vUSDC | TSLA | 0.01 | 0.001 |
| 27 | vNVDA_vUSDC | NVDA | 0.01 | 0.001 |
| 28 | vAAPL_vUSDC | AAPL | 0.01 | 0.001 |
| 29 | vMETA_vUSDC | META | 0.01 | 0.001 |
| 30 | vGOOGL_vUSDC | GOOGL | 0.01 | 0.001 |
| 31 | vAMZN_vUSDC | AMZN | 0.01 | 0.001 |
| 32 | vMSFT_vUSDC | MSFT | 0.01 | 0.001 |
| 33 | aCXMT_vUSDC | CXMT | 0.0001 | 0.1 |

- **Not present: vQQQ, vVOO** (and no ETF tickers at all). Present: BTC, ETH, SOL, MAG7.ssi (as `vMAG7ssi_vUSDC`), plus single stocks TSLA, NVDA, AAPL, META, GOOGL, AMZN, MSFT, and the SSI indices DEFI.ssi, MEME.ssi, USSI.
- All symbols: `status: TRADING`, `minNotional 5` (WSOSO: 1), maker 0.00035 / taker 0.00065, `buyLimitUpRatio 5`, `sellLimitDownRatio 0.8`, `marketDeviationRatio 0.1`, and `maxQuantity`/`maxNotional`/`maxPrice` = 0 (no cap).
- **Liquidity at time of check (bookTickers):** two-sided books on **vBTC** (73860/73861), **vNVDA** (182.21/182.27), vUSSI, vDEFIssi, WSOSO (wide), vBNB, and vSHIB. **vMAG7ssi has bids only (0.45), no asks**, so market BUYs would not fill. vETH is bid-only. vSOL's book is empty. Most stocks are bid-only. Check `bookTickers` before sending a market order, and use limit orders on thin books.

---

## 5. Permissioned keys (mask 14) and proving permissions

- Bit meanings **[doc, schema `APIKeyPermissionEnum`]** (a set bit **disables** the permission; omitting `permissions` enables all):
  - `TRADE=1`: place, replace, modify, **and cancel** orders; schedule cancels; perps leverage/margin
  - `CANCEL=2`: cancel orders and schedule cancels
  - `WITHDRAW=4`: withdraw from spot/perps to EVM or to the other engine
  - `TRANSFER=8`: sub-account and internal transfers
- **Rule [doc]:** "A permissioned API key must disable `TRADE`, `CANCEL`, or both; enabling both `TRADE` and `CANCEL` is not supported." So:
  - **mask 14 (`2|4|8`) is valid**: TRADE stays on; CANCEL, WITHDRAW, and TRANSFER are off. This is the "trading bot, can't move funds" key. Because TRADE's own description includes cancel, the bot can **probably still cancel its orders** **[unverified; test it on testnet]**.
  - **mask 12 (only WITHDRAW|TRANSFER off) is rejected**, because it leaves TRADE and CANCEL both enabled.
  - mask 13 (`1|4|8`) gives a cancel-only key (a "kill switch" key).
  - A plain `addAPIKey` key (no mask) **can** withdraw to the owner's EVM address and transfer to perps. The Python skill lists "spot-to-evm: master or permitted registered key". Use a permissioned key if you want to show users the bot can't move funds.
- **Proving it to a user:** `GET https://testnet-gw.sodex.dev/api/v1/user/{masterAddr}/api-keys?accountID=…&name=…` returns `permissions` per key for **both** `spot` and `perps` (the Python test fixture shows `"permissions": 3`). The field is omitted for ordinary keys, which means all permissions are enabled. Show the user both engine entries plus the `publicKey`, which matches your bot's address. No EVM contract or `eth_call` for key permissions is documented: keys live in the engine state, not in a ValueChain EVM contract. So the gateway API is the only documented proof. For stronger evidence, try a `transferAsset` with the key on testnet and show the rejection.
- Each master account can hold at most 5 keys. Use one key per sub-account or process to avoid nonce races.

---

## 6. TWAP on spot

- Signed action `newTwapOrder` → `POST /api/v1/spot/trade/twaps`. Body (Go struct order): `{"accountID":u64,"symbolID":u64,"side":1|2,"quantity":"<base qty, positive>","minutes":5..1440,"randomize":bool}`. `randomize` is required, even when `false`. Go's struct also has `reduceOnly?`, which is perps-only, so omit it on spot. Response: `{orderID}`.
- Cancel: `cancelTwapOrder` → `DELETE /api/v1/spot/trade/twaps` with `{"accountID","symbolID","orderID"}`.
- Mechanics **[doc, Order Types]:** one suborder every **30 s**, with max **3% slippage** per suborder. A TWAP that falls behind catches up with larger suborders, capped at 3× the normal size. Suborders behave like market orders, so they **will not fill against an empty book**.
- Query: `GET /spot/accounts/{addr}/twaps` (active), `/twaps/history`, `/twaps/trades`. Spot `state.TO` also lists active TWAPs.
- **[unverified]** whether each suborder must meet `minNotional` (5 USDC). If it must, the total notional has to be at least about `5 × minutes × 2`. Neither SDK has a TWAP placement helper (only the Go types and history queries), so this path has less real-world use.
- DCA plans (`newDcaOrder`, `POST /spot/trade/dcas`) also exist on spot. They need USDC-quoted symbols and ≥ 10 USDC per execution.

---

## 7. Gotchas

- **Prefix:** `0x02` only for universal actions (add key, approve builder). Orders, cancels, TWAPs, transfers, and revokes use **`0x01`**.
- **v byte:** normalize viem's 27/28 to 0/1. The golden vectors require it.
- **Spot vs perps body shape:** spot puts `symbolID` **inside each order**. Perps puts it at the top level and adds `modifier`, `reduceOnly`, and `positionSide`. Don't copy the perps examples, which dominate the docs.
- **Action names:** spot uses `batchNewOrder` and `batchCancelOrder`. `newOrder`/`cancelOrder` in the generic docs page is misleading for spot.
- **Hash = body:** the server re-marshals your body into Go structs and hashes the result. Wrong key order, number-typed decimals, non-canonical decimals (`"1.50"`, `"1e-5"`), or `null` optionals all cause a signature mismatch. Hash and send the same string.
- **Filters [doc, live values]:**
  - price must be a multiple of `tickSize` with ≤ `pricePrecision` decimals
  - quantity must be a multiple of `stepSize` and ≥ `minQuantity` (`marketMinQuantity` for market orders)
  - notional ≥ `minNotional` (5 USDC). For market orders without `funds`, the notional is estimated with **`lastTradePrice`**, which is stale on testnet (vBTC last 74973 vs book ~73860).
  - limit buy ≤ `last × (1+5)`, limit sell ≥ `last × (1−0.8)`
- **Rate limits [doc]:**
  - REST: 1200 weight/min/IP. Testnet response headers show `x-ratelimit-limit: 6000` **[live]**. Unlisted endpoints cost 20. Symbols/tickers cost 2. Orderbook costs 5. Account reads cost 5. History costs 20 + 1 per 20 items. A batch order costs `1+floor(N/40)`.
  - Orders: 600/min and 20/s per account with an API key (60/min from the web).
  - Address-based quota: an initial 10,000 actions, then +1 per 1 USDC traded. Once exhausted, you get 1 action per 10 s. Cancels get `min(limit+100000, 2*limit)`.
  - 1000 open orders max per user. WS: 10 connections per IP, 1000 subscriptions per IP.
- **Errors:** HTTP 200 with a negative `code`. A batch can fail as a whole (one error) or per item (`data[i].code != 0`). After a timeout, reconcile via `/orders` and `/orders/history` by `clOrdID` before retrying, because a fresh nonce does not make the retry idempotent.
- **uint64 IDs:** `orderID` and trade IDs can exceed 2^53. Parse with a bigint-aware JSON parser if you keep them.
- **Testnet funding is manual:** whitelist, invite code, and web-UI claim. Plan for each demo user to onboard through `testnet.sodex.com` (claim, then EVM→Spot transfer) before your backend can trade for them. The backend can then do everything else via API.

## 8. Open questions / blockers
1. Faucet: exact tokens and amounts, the daily cooldown, and how to get on the whitelist or obtain an invite code. This could block onboarding hackathon judges. Ask the SoSoValue/SoDEX team for invite codes.
2. Testnet ERC-20 address of test USDC on ValueChain (needed only for programmatic ClobGateway deposits; the UI transfer avoids it).
3. Whether a mask-14 key can still cancel. Whether `expiresAt: 0` means "never expires".
4. Whether TWAP suborders are subject to `minNotional`.
5. No sub-account creation API is documented.
6. Testnet books are thin or one-sided for most symbols, including MAG7.ssi (bids only) and SOL (empty). Live demos should use vBTC or vNVDA, or post your own resting orders from a second account.
