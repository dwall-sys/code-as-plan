# Property-Based Test Templates

Reference document for the cap-validator agent (test mode) when generating property-based tests. Property-based testing verifies invariants that hold for ALL valid inputs, not just hand-picked examples. Recommend `fast-check` as the property testing library.

---

## 1. Booking Invariants

Properties that must hold for any valid booking system.

### No overlapping bookings

```typescript
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

describe('Property: booking invariants', () => {
  // Arbitrary for generating valid booking time ranges
  const bookingArb = fc.record({
    start: fc.date({ min: new Date('2026-01-01'), max: new Date('2026-12-31') }),
    durationMinutes: fc.integer({ min: 15, max: 480 }),
    resourceId: fc.constantFrom('room-a', 'room-b', 'room-c'),
  }).map(({ start, durationMinutes, resourceId }) => ({
    start,
    end: new Date(start.getTime() + durationMinutes * 60000),
    resourceId,
  }));

  it('no two confirmed bookings overlap for the same resource', () => {
    fc.assert(
      fc.property(
        fc.array(bookingArb, { minLength: 2, maxLength: 20 }),
        (bookings) => {
          const confirmed = createBookings(bookings); // system under test
          const byResource = groupByResource(confirmed);

          for (const [, resourceBookings] of Object.entries(byResource)) {
            const sorted = resourceBookings.sort((a, b) => a.start - b.start);
            for (let i = 1; i < sorted.length; i++) {
              // No overlap: previous end <= current start
              expect(sorted[i - 1].end.getTime()).toBeLessThanOrEqual(sorted[i].start.getTime());
            }
          }
        }
      )
    );
  });

  it('booking duration is always positive', () => {
    fc.assert(
      fc.property(bookingArb, (booking) => {
        expect(booking.end.getTime()).toBeGreaterThan(booking.start.getTime());
      })
    );
  });

  it('booking end is always after start', () => {
    fc.assert(
      fc.property(bookingArb, (booking) => {
        const created = createBooking(booking); // system under test
        expect(new Date(created.end_time).getTime()).toBeGreaterThan(
          new Date(created.start_time).getTime()
        );
      })
    );
  });

  it('cancelled booking frees the time slot', () => {
    fc.assert(
      fc.property(bookingArb, (booking) => {
        const created = createBooking(booking);
        cancelBooking(created.id);
        // Same time slot should now be available
        const rebooked = createBooking(booking);
        expect(rebooked.status).toBe('confirmed');
      })
    );
  });
});
```

---

## 2. Auth Invariants

Properties that must hold for any authentication/token system.

### Token encode/decode roundtrip

```typescript
describe('Property: auth token invariants', () => {
  const userPayloadArb = fc.record({
    sub: fc.uuid(),
    email: fc.emailAddress(),
    role: fc.constantFrom('user', 'admin', 'moderator'),
    name: fc.string({ minLength: 1, maxLength: 100 }),
  });

  it('decode(encode(payload)) === payload', () => {
    fc.assert(
      fc.property(userPayloadArb, (payload) => {
        const token = encodeToken(payload);
        const decoded = decodeToken(token);
        expect(decoded.sub).toBe(payload.sub);
        expect(decoded.email).toBe(payload.email);
        expect(decoded.role).toBe(payload.role);
      })
    );
  });

  it('expired tokens are always rejected', () => {
    fc.assert(
      fc.property(
        userPayloadArb,
        fc.integer({ min: 1, max: 365 * 24 * 3600 }), // seconds in past
        (payload, secondsAgo) => {
          const expiredAt = Math.floor(Date.now() / 1000) - secondsAgo;
          const token = encodeToken({ ...payload, exp: expiredAt });
          expect(() => verifyToken(token)).toThrow();
        }
      )
    );
  });

  it('valid tokens are always accepted within TTL', () => {
    fc.assert(
      fc.property(
        userPayloadArb,
        fc.integer({ min: 1, max: 3600 }), // seconds in future
        (payload, secondsFromNow) => {
          const expiresAt = Math.floor(Date.now() / 1000) + secondsFromNow;
          const token = encodeToken({ ...payload, exp: expiresAt });
          const result = verifyToken(token);
          expect(result.sub).toBe(payload.sub);
        }
      )
    );
  });

  it('different payloads produce different tokens', () => {
    fc.assert(
      fc.property(userPayloadArb, userPayloadArb, (a, b) => {
        fc.pre(a.sub !== b.sub); // precondition: different users
        const tokenA = encodeToken(a);
        const tokenB = encodeToken(b);
        expect(tokenA).not.toBe(tokenB);
      })
    );
  });
});
```

---

## 3. Data Invariants

Properties that must hold for any data persistence layer.

### Write-then-read consistency

```typescript
describe('Property: data persistence invariants', () => {
  const resourceArb = fc.record({
    name: fc.string({ minLength: 1, maxLength: 200 }),
    description: fc.string({ maxLength: 1000 }),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 10 }),
    active: fc.boolean(),
    price: fc.float({ min: 0, max: 10000, noNaN: true }),
  });

  it('write then read returns same data', () => {
    fc.assert(
      fc.property(resourceArb, async (resource) => {
        const created = await createResource(resource);
        const fetched = await getResource(created.id);
        expect(fetched.name).toBe(resource.name);
        expect(fetched.description).toBe(resource.description);
        expect(fetched.tags).toEqual(resource.tags);
        expect(fetched.active).toBe(resource.active);
      })
    );
  });

  it('delete then read returns nothing', () => {
    fc.assert(
      fc.property(resourceArb, async (resource) => {
        const created = await createResource(resource);
        await deleteResource(created.id);
        const fetched = await getResource(created.id);
        expect(fetched).toBeNull();
      })
    );
  });

  it('update preserves unmodified fields', () => {
    fc.assert(
      fc.property(
        resourceArb,
        fc.record({ name: fc.string({ minLength: 1, maxLength: 200 }) }),
        async (resource, update) => {
          const created = await createResource(resource);
          await updateResource(created.id, update);
          const fetched = await getResource(created.id);
          // Updated field changed
          expect(fetched.name).toBe(update.name);
          // Non-updated fields preserved
          expect(fetched.description).toBe(resource.description);
          expect(fetched.active).toBe(resource.active);
        }
      )
    );
  });

  it('listing includes all created resources', () => {
    fc.assert(
      fc.property(
        fc.array(resourceArb, { minLength: 1, maxLength: 10 }),
        async (resources) => {
          const ids = [];
          for (const r of resources) {
            const created = await createResource(r);
            ids.push(created.id);
          }
          const list = await listResources();
          for (const id of ids) {
            expect(list.some(item => item.id === id)).toBe(true);
          }
        }
      )
    );
  });
});
```

### String handling invariants

```typescript
describe('Property: string handling', () => {
  it('stored strings are never truncated silently', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        async (input) => {
          const created = await createResource({ name: input });
          const fetched = await getResource(created.id);
          expect(fetched.name.length).toBe(input.length);
        }
      )
    );
  });

  it('unicode strings roundtrip correctly', () => {
    fc.assert(
      fc.property(
        fc.fullUnicode(), // generates full Unicode range
        async (input) => {
          fc.pre(input.length > 0 && input.length <= 200);
          const created = await createResource({ name: input });
          const fetched = await getResource(created.id);
          expect(fetched.name).toBe(input);
        }
      )
    );
  });
});
```

---

## 4. Pagination Invariants

```typescript
describe('Property: pagination', () => {
  it('paginating through all pages returns all items', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }), // total items
        fc.integer({ min: 1, max: 20 }),   // page size
        async (totalItems, pageSize) => {
          // Seed database with totalItems
          await seedResources(totalItems);
          const allItems = [];
          let page = 1;
          let hasMore = true;
          while (hasMore) {
            const result = await listResources({ page, pageSize });
            allItems.push(...result.data);
            hasMore = result.data.length === pageSize;
            page++;
          }
          expect(allItems.length).toBe(totalItems);
          // No duplicates
          const ids = allItems.map(i => i.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      )
    );
  });
});
```

---

## Usage Notes

When generating property-based tests:

1. **Install fast-check**: `npm install -D fast-check`
2. **Start with invariants** -- what must ALWAYS be true, regardless of input?
3. **Use `fc.pre()` for preconditions** -- skip inputs that don't apply
4. **Keep properties simple** -- one property per test, clearly named
5. **Use shrinking** -- fast-check automatically finds minimal failing examples
6. **Combine with example tests** -- property tests complement, not replace, example-based tests
7. **For async properties**: use `fc.assert(fc.asyncProperty(...))`
8. **Set reasonable bounds** -- limit array sizes and string lengths to keep tests fast
9. **Suggest property tests for**: any code with invariants, encode/decode pairs, sorting, filtering, pagination, CRUD operations
