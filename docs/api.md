# Agent HTTP API (contract between agent/ and app/)

Base: `VITE_AGENT_URL` (default `http://localhost:8787`). JSON everywhere. CORS open for GET; POST
accepts the app origin. Types are in `agent/src/types.ts`; `app/src/api.ts` mirrors them.

| Method + path | Returns | Notes |
|---|---|---|
| `GET /health` | `Health` | |
| `GET /baskets` | `{ basket: Basket; target: Record<Symbol, number>; signals: Signal[] }[]` | target = base weights tilted by live signals |
| `GET /signals` | `Signal[]` | cached SoSoValue data |
| `GET /prices` | `Books` | top of book for every basket symbol, from SoDEX testnet |
| `GET /users/:address` | `UserView` or 404 | |
| `GET /users/:address/log?limit=50` | `LogEntry[]` newest first | |
| `GET /log?limit=50` | `LogEntry[]` | all users, public track record |
| `GET /replay/:basketId?floorPct=15&drop=40` | `Replay` | pure simulation through the real `decide()` |
| `POST /users/:address/link-request` | `{ apiKeyName, publicKey, accountId, typedData }` | body `UserRules & { mode: 'live' \| 'paper' }`. For live, the agent reads accountId from SoDEX (`aid == 0` → 409 "not activated"). `typedData` is the exact `UserSignedAddPermissionedAPIKeyAction` (permissions 14) the wallet must sign. For paper, typedData is a plain message to sign (EIP-191) |
| `POST /users/:address/link` | `UserView` | body `{ signature, nonce }`. Live: agent submits the key registration to SoDEX, then verifies via `GET /user/{addr}/api-keys`. Paper: verifies the EIP-191 signature, credits 1,000 paper vUSDC |
| `POST /users/:address/settings` | `UserView` | body `{ rules: Partial<UserRules>, status?: 'active' \| 'paused', message, signature }`. `message` = `Nest settings\naddress:<a>\nnonce:<ms>\n<json of rules+status>`; agent verifies EIP-191 signature by `:address`, nonce within 10 minutes and increasing |

Errors: `{ error: string }` with 400 (bad input), 401 (bad signature), 404, 409, 502 (SoDEX/SoSoValue down).
All address params are checksummed or lowercased hex, validated.
