---
name: docker-openserve
description: Docker deployment with OpenTelemetry and OpenObserve observability
---

# Docker + OpenTelemetry + OpenObserve

## Docker Multi-Stage Pattern

### Backend Dockerfile

```dockerfile
# Build stage
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json packages/*/package.json ./
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

# Production stage
FROM oven/bun:1-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "dist/index.js"]
```

### Docker Compose Pattern

```yaml
# compose.yaml
services:
  backend:
    build: ./apps/backend
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/app
      - REDIS_URL=redis://cache:6379
    depends_on:
      - db
      - cache

  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data

  cache:
    image: redis:7-alpine

  otel-collector:
    image: otel/opentelemetry-collector-contrib
    config: ./otel-collector.yaml

  openobserve:
    image: openobserve/openobserve
    ports:
      - "5080:5080"

volumes:
  pgdata:
```

## OpenTelemetry Setup

### Backend Instrumentation

```typescript
// plugins/telemetry.ts
import { Elysia } from 'elysia'
import { trace, SpanStatusCode } from '@opentelemetry/api'

const tracer = trace.getTracer('backend')

export const telemetryPlugin = new Elysia()
  .onRequest(({ path }) => {
    const span = tracer.startSpan(path)
    return ({ response, path }) => {
      span.setAttribute('http.status_code', response.status)
      span.setStatus(
        response.status < 400 
          ? SpanStatusCode.OK 
          : SpanStatusCode.ERROR
      )
      span.end()
    }
  })
```

### Trace Context Propagation

```typescript
// lib/backend.ts (Eden client)
import { trace } from '@opentelemetry/api'

// Add traceparent to requests
const withTrace = (req: Request) => {
  const span = trace.getActiveSpan()
  if (span) {
    req.headers.set('traceparent', span.spanContext().toString())
  }
  return req
}
```

## OpenObserve Configuration

### OTel Collector Config

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1000
  memory_limiter:
    check_interval: 1s
    limit_mib: 400

exporters:
  otlp:
    endpoint: http://openobserve:5080
    tls:
      insecure: true
  logging:
    loglevel: debug

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch, memory_limiter]
      exporters: [otlp]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp]
```

## Key Patterns

1. **Multi-stage Docker** — Minimize final image size
2. **OTel everywhere** — Backend with OTel, frontend with traceparents
3. **Collector in compose** — Centralized processing
4. **OpenObserve for storage** — Logs, metrics, traces in one place