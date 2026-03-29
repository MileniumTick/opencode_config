# AI Orchestration Architecture

Based on Chapter 19: AI Orchestration Patterns

## Overview

This configuration implements a hierarchical agent system with three levels of orchestration.

## Agent Hierarchy

```
@team-lead (Level 1 - Orchestrator)
    │
    ├─> @backend-lead (Backend - Node, Elysia, Go)
    │       └─> @dev, @exploration
    │
    ├─> @frontend-lead (Frontend - React, Vue, Svelte)
    │       └─> @dev, @ui-ux-partner
    │
    ├─> @data-lead (Data/DB - PostgreSQL, Drizzle)
    │       └─> @exploration
    │
    ├─> @security-lead (Security - OWASP, Auth)
    │       └─> @security
    │
    ├─> @rust-lead (Rust - WASM, Systems)
    │       └─> @dev, @exploration
    │
    ├─> @python-lead (Python - FastAPI, Django)
    │       └─> @dev
    │
    ├─> @devops-lead (DevOps - Docker, CI/CD, Cloud)
    │       └─> @dev, @exploration
    │
    ├─> @mobile-lead (Mobile - React Native, Flutter, Expo)
    │       └─> @dev, @qa, @devops-lead
    │
    └─> @golang-lead (Go - APIs, gRPC, microservices, CLI)
            └─> @dev, @qa, @devops-lead
```

Workers (cross-domain, any lead can delegate to these):
- `@dev` — generic implementation
- `@qa` — testing, quality validation
- `@security` — security vulnerability analysis
- `@exploration` — code analysis, investigation
- `@ui-ux-partner` — UI/UX design, design systems
- `@product-owner` — requirements, user stories

## Levels Summary

### Level 1: Basic Orchestration
- Reasoning before delegating
- Retry with exponential backoff (2, 4, 8, 16s)
- Fallback chains
- Task Ledger tracking

### Level 2: Advanced Orchestration
- Plan-and-Execute pattern
- Hierarchical structure (3 levels max)
- Domain leads for specialized routing
- Complete execution flows

### Level 3: Production Ready
- Three error types handling
- Observability metrics
- Clean Architecture principles
- MCP ecosystem

## Skills

| Skill | Location | Purpose |
|-------|----------|---------| 
| team-orchestrator | ~/.agents/skills/team-orchestrator/ | Main orchestration patterns |
| sdd-workflow | ~/.agents/skills/sdd-workflow/ | SDD methodology |
| domain skills | ~/.agents/skills/* | Technology-specific |

## MCP Servers (Clients)

Currently consuming:
- context7: Codebase context
- gitea: Git operations
- plane: Project management
- engram: Memory/persistence

## Commands

Custom slash commands available in OpenCode TUI:
- `/commit` — generate conventional commit from staged changes
- `/review` — multi-agent code review (exploration + security + qa)

## Usage

1. Simple task → @team-lead delegates directly
2. Complex task → @team-lead creates plan, routes to domain leads
3. Multi-domain → @team-lead coordinates multiple domain leads

## Error Handling

- Retry: 3-5 attempts for APIs, 2-3 for LLMs
- Fallback: Domain lead → Worker → Manual
- Circuit breaker: Stop calling failed services

## Files

- agent/team-lead.md - Main orchestrator
- agent/backend-lead.md - Backend domain lead
- agent/frontend-lead.md - Frontend domain lead
- agent/data-lead.md - Data/DB domain lead
- agent/security-lead.md - Security domain lead
- agent/rust-lead.md - Rust domain lead
- agent/python-lead.md - Python domain lead
- agent/devops-lead.md - DevOps domain lead
- agent/mobile-lead.md - Mobile domain lead (React Native, Flutter)
- agent/golang-lead.md - Go domain lead
- agent/qa.md - Quality assurance worker
- agent/dev.md - Developer worker
- agent/exploration.md - Exploration worker
- agent/security.md - Security worker
- agent/ui-ux-partner.md - UI/UX partner worker
- agent/product-owner.md - Product owner worker
- commands/commit.md - /commit slash command
- commands/review.md - /review slash command
- ORCHESTRATION.md - This file
