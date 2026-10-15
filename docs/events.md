# Contract Events

Soroban contracts emit events that are recorded in the transaction metadata on the Stellar ledger. Each event has a **topic** (an ordered list of XDR values used for filtering) and a **data** payload. Events are not stored in contract state — they live only in the transaction result and can be read by indexers, explorers, and RPC clients via `getTransaction` or `getEvents`. All events from this contract are tagged with `event_type: contract`.

---

## `init`

Emitted once when the airdrop contract is successfully initialized.

### Topic

```
[ Symbol("init"), Address(admin) ]
```

| Position | Type      | Description                        |
|----------|-----------|------------------------------------|
| 0        | `Symbol`  | Literal `"init"`                   |
| 1        | `Address` | The admin account that called `initialize()` |

### Data

```
( BytesN<32>(merkle_root), i128(total_amount) )
```

| Field          | Type          | Description                                              |
|----------------|---------------|----------------------------------------------------------|
| `merkle_root`  | `BytesN<32>`  | The 32-byte Merkle root committed to by the contract     |
| `total_amount` | `i128`        | Total tokens deposited into the contract (in base units) |

### When emitted

At the end of a successful `initialize()` call. Not emitted if initialization fails (e.g. contract already initialized, token transfer fails).

### Example

```json
{
  "type": "contract",
  "ledger": 12345,
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "topic": [
    { "type": "symbol", "value": "init" },
    { "type": "address", "value": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }
  ],
  "data": [
    { "type": "bytes", "value": "a1b2c3d4e5f6...32bytes...hex" },
    { "type": "i128", "value": "1000000000" }
  ]
}
```

---

## `claimed`

Emitted each time a recipient successfully claims their allocation.

### Topic

```
[ Symbol("claimed"), Address(claimant) ]
```

| Position | Type      | Description                                |
|----------|-----------|--------------------------------------------|
| 0        | `Symbol`  | Literal `"claimed"`                        |
| 1        | `Address` | The address that submitted the claim       |

### Data

```
i128(amount)
```

| Field    | Type    | Description                                       |
|----------|---------|---------------------------------------------------|
| `amount` | `i128`  | The number of tokens transferred to the claimant  |

### When emitted

After the Merkle proof is verified and the token transfer to the claimant succeeds. Not emitted if the proof is invalid, the address has already claimed, or the airdrop is inactive.

### Example

```json
{
  "type": "contract",
  "ledger": 12380,
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "topic": [
    { "type": "symbol", "value": "claimed" },
    { "type": "address", "value": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" }
  ],
  "data": { "type": "i128", "value": "1000" }
}
```

---

## `reclaimed`

Emitted when the admin recovers unclaimed tokens from the contract after the airdrop has expired.

### Topic

```
[ Symbol("reclaimed"), Address(admin) ]
```

| Position | Type      | Description                                        |
|----------|-----------|----------------------------------------------------|
| 0        | `Symbol`  | Literal `"reclaimed"`                              |
| 1        | `Address` | The admin account that called `reclaim()`          |

### Data

```
i128(balance)
```

| Field     | Type    | Description                                             |
|-----------|---------|---------------------------------------------------------|
| `balance` | `i128`  | The remaining token balance transferred back to admin   |

### When emitted

After the contract transfers its entire remaining token balance back to the admin. Not emitted if the call is unauthorized or the airdrop has not yet expired.

### Example

```json
{
  "type": "contract",
  "ledger": 99001,
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "topic": [
    { "type": "symbol", "value": "reclaimed" },
    { "type": "address", "value": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }
  ],
  "data": { "type": "i128", "value": "750000" }
}
```

---

## `paused` (emitted by `set_active`)

Emitted whenever the admin pauses or unpauses the airdrop.

> **Naming note:** The contract function is `set_active()`, but the on-chain event symbol is `"paused"`. When filtering events, use the symbol `"paused"` — not `"set_active"`.

### Topic

```
[ Symbol("paused"), Address(admin) ]
```

| Position | Type      | Description                                           |
|----------|-----------|-------------------------------------------------------|
| 0        | `Symbol`  | Literal `"paused"`                                    |
| 1        | `Address` | The admin account that called `set_active()`          |

### Data

```
bool(active)
```

| Field    | Type   | Description                                                          |
|----------|--------|----------------------------------------------------------------------|
| `active` | `bool` | The new active state: `true` = unpaused (claims allowed), `false` = paused (claims blocked) |

### When emitted

After the admin successfully toggles the contract's active state. Not emitted if the caller is not the admin or if the state is set to the same value it already holds.

### Example — pausing the airdrop

```json
{
  "type": "contract",
  "ledger": 13000,
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "topic": [
    { "type": "symbol", "value": "paused" },
    { "type": "address", "value": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }
  ],
  "data": { "type": "bool", "value": false }
}
```

### Example — unpausing the airdrop

```json
{
  "type": "contract",
  "ledger": 13050,
  "contractId": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "topic": [
    { "type": "symbol", "value": "paused" },
    { "type": "address", "value": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }
  ],
  "data": { "type": "bool", "value": true }
}
```

---

## TypeScript event filtering

The Stellar RPC `getEvents` endpoint lets you filter by contract ID and topic. The SDK exposes typed interfaces for all events (see `sdk/src/types.ts`).

### Filter all events for a contract

```typescript
import { Server } from "@stellar/stellar-sdk/rpc";
import type { AirdropEvent } from "@soroban-merkle-airdrop/sdk";

const rpc = new Server("https://soroban-testnet.stellar.org");

const { events } = await rpc.getEvents({
  startLedger: 12000,
  filters: [
    {
      type: "contract",
      contractIds: ["CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"],
    },
  ],
});
```

### Parse events into typed objects

```typescript
import type { AirdropEvent, InitEvent, ClaimedEvent, ReclaimedEvent, PausedEvent } from "@soroban-merkle-airdrop/sdk";

function parseAirdropEvent(raw: any): AirdropEvent | null {
  const symbol = raw.topic[0]?.value as string;
  const address = raw.topic[1]?.value as string;

  switch (symbol) {
    case "init": {
      const [merkleRootRaw, totalAmountRaw] = raw.value as any[];
      const data: InitEvent = {
        admin: address,
        merkleRoot: merkleRootRaw.value as string,
        totalAmount: BigInt(totalAmountRaw.value),
      };
      return { type: "init", data };
    }

    case "claimed": {
      const data: ClaimedEvent = {
        claimant: address,
        amount: BigInt((raw.value as any).value),
      };
      return { type: "claimed", data };
    }

    case "reclaimed": {
      const data: ReclaimedEvent = {
        admin: address,
        balance: BigInt((raw.value as any).value),
      };
      return { type: "reclaimed", data };
    }

    case "paused": {
      const data: PausedEvent = {
        admin: address,
        active: (raw.value as any).value as boolean,
      };
      return { type: "paused", data };
    }

    default:
      return null;
  }
}

// Usage
const typed = events.map(parseAirdropEvent).filter(Boolean) as AirdropEvent[];

// Filter to just claim events
const claims = typed
  .filter((e): e is { type: "claimed"; data: ClaimedEvent } => e.type === "claimed")
  .map((e) => e.data);

console.log(`Total claims: ${claims.length}`);
console.log(`Total claimed: ${claims.reduce((sum, c) => sum + c.amount, 0n)}`);
```

### Filter by topic (claimed events only)

The RPC also supports server-side topic filtering so you only receive the event type you care about:

```typescript
const { events: claimEvents } = await rpc.getEvents({
  startLedger: 12000,
  filters: [
    {
      type: "contract",
      contractIds: ["CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA"],
      // topic[0] must be the symbol "claimed"
      topics: [["AAAADAAAAAdpbml0aWFsaXplZA=="]],  // base64-encoded XDR for Symbol("claimed")
    },
  ],
});
```

> **Tip:** For easier topic filtering without manual XDR encoding, use the event-parsing helper above and filter client-side — the volume of events from a single contract is typically low enough that this is practical.

---

## Event summary

| Event symbol | Function     | Topic[1]  | Data type(s)                    |
|--------------|--------------|-----------|----------------------------------|
| `init`       | `initialize` | admin     | `(BytesN<32>, i128)`            |
| `claimed`    | `claim`      | claimant  | `i128`                          |
| `reclaimed`  | `reclaim`    | admin     | `i128`                          |
| `paused`     | `set_active` | admin     | `bool`                          |
