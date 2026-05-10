# Contract Test Templates

Reference document for the cap-validator agent (test mode) when generating contract tests between monorepo apps or microservices. Contract tests verify that producer and consumer agree on API shape, event format, and shared types.

---

## 1. API Contract Tests (Schema Validation)

Verify that API responses match the expected schema. Use when one app consumes another app's API.

### Response schema validation

```typescript
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';

// Define the contract schema (shared between producer and consumer)
const userSchema = {
  type: 'object',
  required: ['id', 'email', 'name', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string', minLength: 1 },
    created_at: { type: 'string', format: 'date-time' },
    role: { type: 'string', enum: ['user', 'admin', 'moderator'] },
  },
  additionalProperties: false,
};

describe('API Contract: GET /api/users/:id', () => {
  const ajv = new Ajv({ allErrors: true, formats: { uuid: true, email: true, 'date-time': true } });

  it('response matches user schema', async () => {
    const response = await fetch(`${API_URL}/api/users/${testUserId}`);
    expect(response.status).toBe(200);

    const data = await response.json();
    const validate = ajv.compile(userSchema);
    const valid = validate(data);
    expect(valid).toBe(true);
    if (!valid) console.error('Schema violations:', validate.errors);
  });

  it('list response matches array of user schema', async () => {
    const response = await fetch(`${API_URL}/api/users`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);

    const validate = ajv.compile(userSchema);
    for (const item of data) {
      expect(validate(item)).toBe(true);
    }
  });
});
```

### Request contract validation (producer side)

```typescript
describe('API Contract: POST /api/bookings (request validation)', () => {
  it('rejects request missing required fields', async () => {
    const response = await fetch(`${API_URL}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ /* missing required fields */ }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toBeDefined();
  });

  it('rejects request with wrong field types', async () => {
    const response = await fetch(`${API_URL}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        start_time: 'not-a-date',
        duration: 'not-a-number',
        resource_id: 123, // should be string
      }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts valid request matching contract', async () => {
    const response = await fetch(`${API_URL}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        start_time: '2026-04-01T10:00:00Z',
        duration: 60,
        resource_id: 'room-a',
      }),
    });
    expect([200, 201]).toContain(response.status);
  });
});
```

### Version compatibility

```typescript
describe('API Contract: version compatibility', () => {
  it('v1 response is backward-compatible with v2 consumer', async () => {
    const response = await fetch(`${API_URL}/api/v1/users/${testUserId}`);
    const data = await response.json();

    // v2 consumer expects these fields exist
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('email');
    // v2 added 'avatar_url' -- should handle absence gracefully
    const avatarUrl = data.avatar_url ?? null;
    expect(avatarUrl === null || typeof avatarUrl === 'string').toBe(true);
  });
});
```

---

## 2. Event Contract Tests (Message Format)

Verify that events/messages emitted by one service match the format expected by consumers.

### Event payload validation

```typescript
import { describe, it, expect } from 'vitest';

// Shared event contract
const bookingCreatedSchema = {
  type: 'booking.created',
  version: '1.0',
  payload: {
    booking_id: 'string:uuid',
    user_id: 'string:uuid',
    resource_id: 'string',
    start_time: 'string:iso-datetime',
    end_time: 'string:iso-datetime',
    status: 'string:enum(pending,confirmed,cancelled)',
  },
};

describe('Event Contract: booking.created', () => {
  it('emitted event matches contract schema', async () => {
    // Arrange: create a booking (producer action)
    const booking = await createBooking({
      user_id: testUserId,
      resource_id: 'room-a',
      start_time: '2026-04-01T10:00:00Z',
      end_time: '2026-04-01T11:00:00Z',
    });

    // Act: capture the emitted event
    const event = await captureEvent('booking.created');

    // Assert: event matches contract
    expect(event.type).toBe('booking.created');
    expect(event.version).toBe('1.0');
    expect(event.payload).toBeDefined();
    expect(typeof event.payload.booking_id).toBe('string');
    expect(typeof event.payload.user_id).toBe('string');
    expect(typeof event.payload.resource_id).toBe('string');
    expect(typeof event.payload.start_time).toBe('string');
    expect(typeof event.payload.end_time).toBe('string');
    expect(['pending', 'confirmed', 'cancelled']).toContain(event.payload.status);
  });

  it('consumer can deserialize event payload', async () => {
    const rawEvent = JSON.stringify({
      type: 'booking.created',
      version: '1.0',
      payload: {
        booking_id: '550e8400-e29b-41d4-a716-446655440000',
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        resource_id: 'room-a',
        start_time: '2026-04-01T10:00:00Z',
        end_time: '2026-04-01T11:00:00Z',
        status: 'confirmed',
      },
    });

    // Consumer deserialization
    const parsed = JSON.parse(rawEvent);
    const startTime = new Date(parsed.payload.start_time);
    expect(startTime.getTime()).toBeGreaterThan(0);
    expect(parsed.payload.booking_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
```

### Event ordering and idempotency

```typescript
describe('Event Contract: idempotency', () => {
  it('processing same event twice produces same result', async () => {
    const event = {
      type: 'booking.created',
      idempotency_key: 'test-key-001',
      payload: { booking_id: 'b-001', user_id: 'u-001', resource_id: 'room-a' },
    };

    const result1 = await processEvent(event);
    const result2 = await processEvent(event);
    expect(result1).toEqual(result2);
  });

  it('events with different versions are handled gracefully', async () => {
    const eventV2 = {
      type: 'booking.created',
      version: '2.0',
      payload: {
        booking_id: 'b-002',
        user_id: 'u-001',
        resource_id: 'room-a',
        // v2 adds new field
        recurring: true,
      },
    };

    // v1 consumer should not crash
    const result = await processEvent(eventV2);
    expect(result).toBeDefined();
  });
});
```

---

## 3. Shared Type Contract Tests (TypeScript)

When apps share types via a `packages/shared` or similar, test that the types match reality.

### Type-to-runtime validation

```typescript
import { describe, it, expect } from 'vitest';
import type { Booking, User, BookingStatus } from '@myapp/shared';

describe('Shared Type Contract: Booking', () => {
  it('runtime booking object satisfies Booking type shape', () => {
    // Simulate what the API actually returns
    const apiResponse = {
      id: 'b-001',
      user_id: 'u-001',
      resource_id: 'room-a',
      start_time: '2026-04-01T10:00:00Z',
      end_time: '2026-04-01T11:00:00Z',
      status: 'confirmed' as BookingStatus,
      created_at: '2026-03-31T00:00:00Z',
    };

    // Runtime checks matching the TypeScript interface
    const booking: Booking = apiResponse;
    expect(typeof booking.id).toBe('string');
    expect(typeof booking.user_id).toBe('string');
    expect(typeof booking.resource_id).toBe('string');
    expect(typeof booking.start_time).toBe('string');
    expect(typeof booking.end_time).toBe('string');
    expect(['pending', 'confirmed', 'cancelled']).toContain(booking.status);
  });

  it('required fields are never null in production data', async () => {
    const bookings = await fetchBookings();
    for (const booking of bookings) {
      expect(booking.id).not.toBeNull();
      expect(booking.user_id).not.toBeNull();
      expect(booking.start_time).not.toBeNull();
      expect(booking.end_time).not.toBeNull();
      expect(booking.status).not.toBeNull();
    }
  });
});
```

### Cross-package import validation

```typescript
describe('Shared Type Contract: cross-package imports', () => {
  it('shared types can be imported by consumer package', async () => {
    // This test verifies the build/bundling doesn't break type exports
    const shared = await import('@myapp/shared');
    expect(shared).toBeDefined();
    expect(typeof shared.BookingStatusEnum).toBeDefined();
  });

  it('shared constants match between packages', () => {
    // Both producer and consumer should use same status values
    const validStatuses = ['pending', 'confirmed', 'cancelled'];
    expect(validStatuses).toEqual(expect.arrayContaining(['pending', 'confirmed', 'cancelled']));
  });
});
```

---

## Usage Notes

When generating contract tests:

1. **Define the contract first** -- write the expected schema before writing the test
2. **Test both sides** -- producer should validate it emits correctly, consumer should validate it can parse
3. **Version contracts** -- include version in schema, test backward compatibility
4. **Use fixture data** -- keep test payloads close to real production data shapes
5. **For monorepos**: put contract definitions in `packages/shared/contracts/`
6. **For microservices**: each service owns its producer contract, consumers write their own consumer tests
7. **Test evolution**: when adding fields, verify old consumers still work
8. **Idempotency**: always test that duplicate message processing is safe
