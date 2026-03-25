---
name: contract-typebox
description: TypeBox schema patterns for API contracts and validation
---

# TypeBox Contracts

## Overview

TypeBox provides compile-time type definitions that work at runtime for validation. All API schemas live in `packages/shared/contracts`.

## Basic Schema Pattern

```typescript
import { Type, Static } from '@sinclair/typebox'

// Define schema
const UserSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String({ format: 'email' }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  role: Type.Union([Type.Literal('admin'), Type.Literal('user')]),
  createdAt: Type.String({ format: 'date-time' })
})

// Extract TypeScript type
type User = Static<typeof UserSchema>
```

## Validation Patterns

### Elysia Route
```typescript
import { Elysia, t } from 'elysia'

app.post('/users', ({ body }) => {
  // body is typed as User
  return createUser(body)
}, {
  body: UserSchema
})
```

### Frontend Form Validation
```typescript
import { validate } from 'shared/contracts'
import { UserSchema } from 'shared/contracts/users'

const formData = { ... }
const [errors, data] = validate(UserSchema, formData)
if (errors) showErrors(errors)
```

## Common Patterns

### Optional Fields
```typescript
const UpdateUserSchema = Type.Partial(UserSchema)
```

### Nested Objects
```typescript
const AddressSchema = Type.Object({
  street: Type.String(),
  city: Type.String(),
  country: Type.String()
})

const UserWithAddressSchema = Type.Object({
  ...UserSchema.properties,
  address: AddressSchema
})
```

### Arrays
```typescript
const UserListSchema = Type.Array(UserSchema)
```

### Query Params
```typescript
const PaginationSchema = Type.Object({
  page: Type.Integer({ minimum: 1, default: 1 }),
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  sort: Type.Optional(Type.String())
})
```

## Contract Structure

```
packages/shared/src/
├── contracts/
│   ├── index.ts        # Export all
│   ├── users.ts        # User schemas
│   ├── auth.ts         # Auth schemas
│   └── pagination.ts   # Common patterns
└── index.ts           # Re-export from contracts
```

## Best Practices

1. **Single source** — Define once in shared, use everywhere
2. **Descriptive errors** — Add `error` field for custom messages
3. **Versioning** — Add `version` field to schemas for API evolution
4. **Composition** — Use `Type.Transform` for computed fields