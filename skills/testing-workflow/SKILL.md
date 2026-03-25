---
name: testing-workflow
description: Testing patterns - Bun Test for backend, Vitest + Playwright for frontend
---

# Testing Workflow

## Backend — Bun Test

### Setup

```json// apps/backend/package.json
{
  "scripts": {
    "test": "bun test",
    "test:watch": "bun test --watch"
  }
}
```

### Unit Test Pattern

```typescript
// services/user.test.ts
import { describe, it, expect, beforeEach } from 'bun:test'
import { createUser, getUserByEmail } from './user'

describe('user service', () => {
  it('creates user with valid data', async () => {
    const user = await createUser({
      email: 'test@example.com',
      name: 'Test'
    })
    expect(user.email).toBe('test@example.com')
  })

  it('throws on duplicate email', async () => {
    await expect(createUser({
      email: 'exists@example.com',
      name: 'Test'
    })).rejects.toThrow('Email exists')
  })
})
```

### Integration Test Pattern

```typescript
// routes/users.test.ts
import { describe, it, expect, beforeAll } from 'bun:test'
import { Elysia } from 'elysia'
import { app } from './index'

describe('GET /users', () => {
  it('returns user list', async () => {
    const response = await app.handle(
      new Request('http://localhost/users')
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })
})
```

### Run Commands

```bash
bun test              # Run all
bun test src/user     # Specific file
bun test --bail      # Stop on first failure
```

## Frontend — Vitest + Playwright

### Vitest (Unit)

```typescript
// components/Button.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './Button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeDefined()
  })

  it('applies variant classes', () => {
    const { container } = render(<Button variant="destructive">Delete</Button>)
    expect(container.firstChild).toHaveClass('bg-red-500')
  })
})
```

### Playwright (E2E)

```typescript
// tests/auth.spec.ts
import { test, expect } from '@playwright/test'

test('user can login', async ({ page }) => {
  await page.goto('/login')
  await page.fill('[name="email"]', 'test@example.com')
  await page.fill('[name="password"]', 'password123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL('/dashboard')
})
```

### Config Pattern

```typescript// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true
  }
})
```

```typescript// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:5173' },
  webServer: { command: 'bun run dev', port: 5173 }
})
```

### Run Commands

```bash
bun test               # Vitest unit tests
bunx playwright test   # Playwright e2e
bunx playwright test --ui  # Interactive mode
```

## Testing Philosophy

1. **Test behavior, not implementation** — Focus on outputs
2. **Arrange-Act-Assert** — Clear test structure
3. **Isolate** — Mock external dependencies
4. **Fast feedback** — Unit tests for quick checks
5. **Real flows** — Playwright for critical paths