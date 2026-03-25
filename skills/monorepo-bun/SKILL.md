---
name: monorepo-bun
description: Monorepo structure and Bun workspace conventions for this project
---

# Monorepo Structure — Bun Workspaces

## Root Configuration

```json// package.json
{
  "name": "my-monorepo",
  "workspaces": ["apps/*", "packages/*"]
}
```

## Workspace Types

```
monorepo/
├── apps/
│   ├── frontend/        # React SPA (Vite)
│   └── backend/        # Elysia BFF server
├── packages/
│   └── shared/         # TypeBox contracts, shared types
└── biome.json          # Root lint/format config
```

## Package.json Patterns

### apps/backend/package.json
```json
{
  "name": "@myapp/backend",
  "version": "0.0.0",
  "dependencies": {
    "shared": "workspace:*"
  }
}
```

### packages/shared/package.json
```json
{
  "name": "shared",
  "version": "0.0.0",
  "exports": {
    ".": "./src/index.ts",
    "./contracts": "./src/contracts/index.ts"
  }
}
```

## Running Commands

```bash
# Install all workspaces
bun install

# Run command in specific workspace
bun run --filter @myapp/backend dev

# Run across all workspaces
bun run -r biome check .

# Type check entire monorepo
bun run -r tsc --noEmit
```

## Biome Configuration

Root `biome.json` applies to all projects:

```json
{
  "$schema": "https://biomejs.dev/schemas/1.8.0/schema.json",
  "files": {
    "ignore": ["node_modules/**", "dist/**"]
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

## TypeScript Paths

For imports like `@myapp/shared` or `shared/contracts`:

```json// apps/backend/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@myapp/shared": ["../../packages/shared/src"],
      "shared/*": ["../../packages/shared/src/*"]
    }
  }
}
```

## Key Conventions

1. **No duplicate code** — Shared logic in `packages/shared`
2. **TypeBox contracts** — All API schemas in `packages/shared/contracts`
3. **Single source of truth** — Frontend imports contracts, never redefines
4. **Biome for all** — No eslint/prettier configs in individual packages