---
name: backend-elysia
description: Elysia web framework patterns with Drizzle ORM and Better Auth
---

# Backend — Elysia + Drizzle + Better Auth

## Project Structure

```
apps/backend/src/
├── plugins/           # Elysia plugins
│   ├── cors.ts        # CORS configuration
│   ├── rate-limit.ts  # Rate limiting
│   └── auth.ts        # Better Auth setup
├── routes/           # API endpoints
│   ├── index.ts       # Route aggregation
│   ├── users.ts
│   └── auth.ts
├── services/         # Business logic
├── db/
│   ├── index.ts      # Drizzle client
│   ├── schema.ts     # Table definitions
│   └── migrations/   # SQL migrations
├── lib/              # Utilities
└── index.ts          # Entry point
```

## Elysia Basic Pattern

```typescript
import { Elysia, t } from 'elysia'

const app = new Elysia()
  .use(corsPlugin)
  .use(rateLimitPlugin)
  .use(authPlugin)
  .use(userRoutes)
  .use(authRoutes)
  .listen(3000)
```

## Drizzle Schema Pattern

```typescript
// db/schema.ts
import { pgTable, uuid, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['admin', 'user'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }),
  role: roleEnum('role').default('user'),
  createdAt: timestamp('created_at').defaultNow()
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
```

## Better Auth Setup

```typescript
// plugins/auth.ts
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '../db'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    github: { clientId: process.env.GITHUB_ID, clientSecret: process.env.GITHUB_SECRET }
  }
})
```

## Eden API Generation

```typescript
// Generate typed client for frontend
// Run: bunx elysia-eden
// Output: frontend/src/lib/backend.ts
```

Then frontend imports:
```typescript
import { client } from '@/backend'
const { users } = client
```

## Common Patterns

### Protected Route
```typescript
app.get('/profile', ({ cookie }) => {
  const session = cookie['better-auth'].value
  return getProfile(session)
})
```

### Validation with TypeBox
```typescript
app.post('/users', ({ body }) => createUser(body), {
  body: t.Object({
    email: t.String({ format: 'email' }),
    name: t.String({ minLength: 1 })
  })
})
```

### Error Handling
```typescript
app.onError(({ code, error }) => {
  if (code === 'NOT_FOUND') return { error: 'Not found' }
  return { error: 'Internal error' }
})
```

## Security

- CORS: Restrict to `FRONTEND_URL`
- Rate limit: `@elysiajs/rate-limit`
- Input: TypeBox validation always
- Auth: HttpOnly cookie with opaque token