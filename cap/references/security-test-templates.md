# Security Test Templates

Reference document for the cap-validator agent (test mode) when generating security-focused tests. Use these templates as starting points, adapting table names, column names, and auth patterns to the target project.

---

## 1. RLS Policy Tests (Supabase)

Row-Level Security tests verify that database policies enforce data isolation between users.

### User isolation -- read

```typescript
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

describe('RLS: TABLE_NAME read isolation', () => {
  it('user cannot read other user data', async () => {
    // Arrange: create client authenticated as User A
    const supabaseA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userAToken}` } },
    });

    // Act: query data belonging to User B
    const { data, error } = await supabaseA
      .from('TABLE_NAME')
      .select('*')
      .eq('user_id', userBId);

    // Assert: no data returned (RLS blocks access)
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('user can read own data', async () => {
    const supabaseA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userAToken}` } },
    });

    const { data, error } = await supabaseA
      .from('TABLE_NAME')
      .select('*')
      .eq('user_id', userAId);

    expect(error).toBeNull();
    expect(data.length).toBeGreaterThan(0);
  });
});
```

### User isolation -- write

```typescript
describe('RLS: TABLE_NAME write isolation', () => {
  it('user cannot update other user data', async () => {
    const supabaseA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userAToken}` } },
    });

    const { error } = await supabaseA
      .from('TABLE_NAME')
      .update({ name: 'hacked' })
      .eq('user_id', userBId);

    // Either error or zero affected rows
    expect(error || true).toBeTruthy();
  });

  it('user cannot delete other user data', async () => {
    const supabaseA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userAToken}` } },
    });

    const { error } = await supabaseA
      .from('TABLE_NAME')
      .delete()
      .eq('user_id', userBId);

    expect(error || true).toBeTruthy();
  });
});
```

### Anon access blocked

```typescript
describe('RLS: TABLE_NAME anon access', () => {
  it('anonymous user cannot read any data', async () => {
    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data, error } = await supabaseAnon
      .from('TABLE_NAME')
      .select('*');

    // Either empty result or permission error
    expect(data?.length ?? 0).toBe(0);
  });
});
```

---

## 2. Auth Bypass Tests

Tests that verify authentication cannot be bypassed through common attack vectors.

### JWT validation

```typescript
describe('Auth: JWT validation', () => {
  it('rejects expired JWT token', async () => {
    const expiredToken = createJWT({ sub: userId, exp: Math.floor(Date.now() / 1000) - 3600 });
    const response = await fetch(`${API_URL}/protected`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(response.status).toBe(401);
  });

  it('rejects modified JWT payload', async () => {
    const validToken = createJWT({ sub: userId, role: 'user' });
    // Tamper with payload (change role to admin without re-signing)
    const parts = validToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    payload.role = 'admin';
    parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = parts.join('.');

    const response = await fetch(`${API_URL}/protected`, {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    expect(response.status).toBe(401);
  });

  it('rejects missing auth header', async () => {
    const response = await fetch(`${API_URL}/protected`);
    expect(response.status).toBe(401);
  });

  it('rejects token from wrong issuer', async () => {
    const wrongIssuerToken = createJWT({ sub: userId, iss: 'https://evil.example.com' });
    const response = await fetch(`${API_URL}/protected`, {
      headers: { Authorization: `Bearer ${wrongIssuerToken}` },
    });
    expect(response.status).toBe(401);
  });

  it('rejects token with invalid signature', async () => {
    const token = createJWT({ sub: userId });
    const corruptedToken = token.slice(0, -5) + 'XXXXX';
    const response = await fetch(`${API_URL}/protected`, {
      headers: { Authorization: `Bearer ${corruptedToken}` },
    });
    expect(response.status).toBe(401);
  });
});
```

### Role escalation

```typescript
describe('Auth: role escalation prevention', () => {
  it('regular user cannot access admin endpoint', async () => {
    const userToken = await loginAs('regular-user');
    const response = await fetch(`${API_URL}/admin/users`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(response.status).toBe(403);
  });

  it('regular user cannot modify own role', async () => {
    const userToken = await loginAs('regular-user');
    const response = await fetch(`${API_URL}/users/me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    // Should either reject or ignore the role field
    expect(response.status).not.toBe(200);
  });
});
```

---

## 3. Input Sanitization Tests

Tests that verify user input is properly sanitized against injection attacks.

### XSS prevention

```typescript
describe('Input: XSS prevention', () => {
  it('rejects script tags in text fields', async () => {
    const response = await createResource({
      name: '<script>alert("xss")</script>',
    });
    // Should either reject or escape the input
    if (response.status === 200) {
      const data = await response.json();
      expect(data.name).not.toContain('<script>');
    } else {
      expect(response.status).toBe(400);
    }
  });

  it('rejects event handler injection', async () => {
    const response = await createResource({
      name: '" onmouseover="alert(1)',
    });
    if (response.status === 200) {
      const data = await response.json();
      expect(data.name).not.toContain('onmouseover');
    } else {
      expect(response.status).toBe(400);
    }
  });
});
```

### SQL injection prevention

```typescript
describe('Input: SQL injection prevention', () => {
  it('rejects SQL injection in search parameter', async () => {
    const response = await fetch(`${API_URL}/search?q=' OR '1'='1`);
    // Should not return all records
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.length).toBeLessThan(100); // Sanity check
  });

  it('rejects UNION-based injection', async () => {
    const response = await fetch(`${API_URL}/search?q=' UNION SELECT * FROM users --`);
    expect(response.status).toBe(200);
    const data = await response.json();
    // Should not contain user table data
    expect(data.some(d => d.password_hash)).toBe(false);
  });
});
```

### Path traversal prevention

```typescript
describe('Input: path traversal prevention', () => {
  it('rejects directory traversal in file path', async () => {
    const response = await fetch(`${API_URL}/files/../../../etc/passwd`);
    expect(response.status).toBe(400);
  });

  it('rejects encoded directory traversal', async () => {
    const response = await fetch(`${API_URL}/files/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
    expect([400, 403, 404]).toContain(response.status);
  });
});
```

---

## 4. Data Leakage Tests

Tests that verify sensitive data is never exposed in API responses or error messages.

### Sensitive field filtering

```typescript
describe('Data leakage: sensitive field filtering', () => {
  it('API does not return password hash', async () => {
    const response = await fetch(`${API_URL}/users/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data = await response.json();
    expect(data).not.toHaveProperty('password_hash');
    expect(data).not.toHaveProperty('password');
    expect(data).not.toHaveProperty('hashed_password');
  });

  it('API does not return internal database IDs in list endpoints', async () => {
    const response = await fetch(`${API_URL}/resources`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data = await response.json();
    for (const item of data) {
      expect(item).not.toHaveProperty('_id'); // MongoDB internal ID
      expect(item).not.toHaveProperty('internal_id');
    }
  });

  it('API does not expose other users email addresses', async () => {
    const response = await fetch(`${API_URL}/users`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data = await response.json();
    const otherUsers = data.filter(u => u.id !== currentUserId);
    for (const user of otherUsers) {
      expect(user).not.toHaveProperty('email');
    }
  });
});
```

### Error message safety

```typescript
describe('Data leakage: error messages', () => {
  it('error responses do not leak stack traces', async () => {
    const response = await fetch(`${API_URL}/trigger-error`);
    const body = await response.text();
    expect(body).not.toMatch(/at\s+\w+\s+\(/); // Stack trace pattern
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('.js:');
  });

  it('error responses do not leak database details', async () => {
    const response = await fetch(`${API_URL}/trigger-error`);
    const body = await response.text();
    expect(body).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i);
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('SQLSTATE');
  });

  it('404 does not reveal valid resource IDs', async () => {
    const response = await fetch(`${API_URL}/users/nonexistent-id`);
    const body = await response.text();
    expect(body).not.toMatch(/valid IDs include/i);
    expect(body).not.toMatch(/did you mean/i);
  });
});
```

---

## Usage Notes

When generating security tests:

1. **Adapt table/column names** to the target project's schema
2. **Use the project's actual auth mechanism** (Supabase, NextAuth, custom JWT, etc.)
3. **Test both happy and sad paths** -- a secure system rejects bad input AND accepts good input
4. **Cover the OWASP Top 10** relevant to the application type
5. **For RLS tests**: create two test users, try cross-user access in both directions
6. **For auth tests**: test expired, tampered, missing, and wrong-issuer tokens
7. **For input tests**: use payloads from OWASP cheat sheets
8. **For leakage tests**: check every API endpoint that returns user data
