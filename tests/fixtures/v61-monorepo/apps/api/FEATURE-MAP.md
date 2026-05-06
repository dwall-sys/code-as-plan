# Feature Map — apps/api

> Table-style + mixed long-form/numeric feature IDs.

## Features

### F-API-USERS: User CRUD [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | POST /users creates a new account |
| AC-2 | pending | GET /users/:id returns 404 on missing |

**Files:**
- `src/users/handler.ts`
- `src/users/repository.ts`

### F-API-AUTH: Auth tokens [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | JWT issuance on login |
| AC-2 | pending | Refresh-token rotation |
| AC-3 | pending | Token revocation list |

**Files:**
- `src/auth/jwt.ts`
- `src/auth/refresh.ts`

### F-API-RATELIMIT: Rate limiting [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Per-IP token bucket |

### F-API-METRICS: Metrics endpoint [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Prometheus exposition |

### F-API-HEALTH: Health checks [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | /health/live readiness |

### F-API-ORDERS: Orders endpoint [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Order placement flow |

### F-API-PRODUCTS: Product catalog [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Catalog query API |

### F-API-PAYMENTS: Payment integration [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Stripe webhook handler |

### F-API-SHIPPING: Shipping calc [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Carrier rate lookup |

### F-API-INVENTORY: Inventory state [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Stock decrement |

### F-API-WEBHOOKS: Outbound webhooks [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Retry with backoff |

### F-API-AUDIT: Audit log [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Append-only event log |

### F-API-EMAIL: Transactional email [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Templated send |

### F-API-EXPORT: Data export [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | CSV / JSON streaming |

### F-API-IMPORT: Bulk import [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Batched insert |

### F-201: API request validation [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Zod schema gate |

### F-202: API response shaping [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Pagination envelope |

### F-203: API error mapping [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | RFC7807 problem JSON |

### F-204: API tracing [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | OTel context propagation |

### F-205: API DB pool [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Connection lifecycle |

### F-206: API migrations [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Forward-only schema |

### F-207: API queue worker [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Background job runner |

### F-208: API cache layer [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Redis-backed read cache |

### F-209: API session store [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Sliding-window TTL |

### F-210: API config loader [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Env + secrets manager |

### F-211: API deploy hooks [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Pre/post deploy steps |

### F-212: API feature toggles [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Per-tenant flags |

### F-213: API graceful shutdown [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Drain in-flight reqs |

### F-214: API request id [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | UUID propagation |

### F-215: API logging level [planned]

| AC | Status | Description |
|----|--------|-------------|
| AC-1 | pending | Per-request override |

## Legend

| State | Meaning |
|-------|---------|
| planned | Feature identified, not yet implemented |
| prototyped | Initial implementation exists |
| tested | Tests written and passing |
| shipped | Deployed / merged to main |

---
*Last updated: 2026-05-06T15:00:00.000Z*
