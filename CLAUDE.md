# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

whosfree ("Who's Free") is a PWA that shows which friends are free right now, built from their uploaded class schedules and Google Calendar. `PRD.md` holds the requirements and `ISSUES.md` is the work tracker. Both are large, so grep them by ID rather than reading them whole.

## Commands

pnpm workspaces + Turborepo. Node 22 (`.nvmrc`), pnpm 10.

```sh
pnpm install
pnpm build | dev | lint | typecheck | test      # turbo run <task> across all workspaces
pnpm format / pnpm format:check                  # prettier (root)

# One package
pnpm --filter @whosfree/shared test
pnpm --filter @whosfree/shared typecheck

# One test file / one test (Vitest)
pnpm --filter @whosfree/shared test src/schemas.test.ts
pnpm --filter @whosfree/shared test -t "rejects a zero-length event"
```

Before changing `turbo.json` or turbo commands, read `AGENTS.md`. The installed Turborepo version may behave differently from what you expect, and its bundled docs are the reference.

## Repo state and target architecture

Only Phase 0 exists so far. `apps/` is empty, and `packages/` contains:
- `config`: shared tsconfig (`tsconfig/base.json`), ESLint flat config (`./eslint`) and Prettier config (`./prettier`). Each package re-exports the ESLint config from its own `eslint.config.js` and extends the base tsconfig.
- `shared`: zod schemas and constants (statuses, tiers, permissions, ping templates, event drafts). Web, backend, worker and parser all use it.

PRD §8.2 plans more workspaces: `apps/web` (Next.js App Router PWA on Vercel), `apps/worker` (Hono on Railway, for PDF/HEIC processing and LLM parse jobs through OpenRouter), `packages/backend` (Supabase migrations, RLS, SQL functions, generated types), `packages/availability` (pure TS engine with no I/O), `packages/parser` and `packages/ui` (shared React components, Tailwind + shadcn/ui). Follow that layout when you scaffold them.

Rules that span multiple files:
- **Internal packages ship TypeScript source, not build output.** For example, `@whosfree/shared` exports `./src/index.ts`. That's why `lint`, `typecheck` and `test` depend on the no-op `transit` task (`dependsOn: ["^transit"]`) and not on `^build`: a change in a dependency still invalidates its dependants' caches.
- **Postgres is the single place where authorization happens** (PRD §8.1, D40/D41). Clerk JWTs are trusted by Supabase through third-party auth, and RLS keys on `auth.jwt()->>'sub'`. Other users' data is only reachable through `security definer` functions that apply tier redaction (`resolve_tier`/`redact`). Multi-step writes are single SQL functions. Realtime Broadcast only carries "changed" signals, and clients re-fetch through the redacting functions.
- **No location data anywhere** (D35). Event schemas have no location field, and zod strips unknown keys like `location`/`room`. Tests enforce this.
- `no-console` allows only `warn`/`error` (NFR-SEC-11): logs must never contain event titles, ping text or tokens.
- Constants and schemas carry PRD references (`FR-…`, `NFR-…`, `D…`) in comments. Keep doing that, and put shared values in `packages/shared`. Don't redefine them per app.
- TS is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`, so use `import type` for types (ESLint enforces `consistent-type-imports`).

## Workflow conventions

- Work is tracked as `WF-###` issues in `ISSUES.md` (see its §1 "How this file works"). When you start or finish an issue, update its status **in both** the index row and the issue body, tick its acceptance criteria, and update "Ready to start". New issues and bugs take the next free ID, which is recorded in §1. If scope changes, update the PRD first.
- Commit messages follow `type(scope): summary (WF-###)`, e.g. `feat(parser): recurring extraction (WF-028)`.
- Prettier ignores all `*.md` files, `pnpm-lock.yaml`, generated `database.types.ts` and the design export folder.

## UI and design

- **Visual reference:** `Who's Free scheduling UI/Whos Free.dc.html` (a design-tool export; open it in a browser). Match its layout, hierarchy and look when you build UI. Don't copy its markup, though: it's generated, with inline styles, `{{ }}` template bindings, a fixed 1440px frame and a bundled runtime (`support.js`). Don't edit or import anything from that folder. Its main tokens, to carry into the Tailwind/shadcn theme variables:
  - fonts: Onest (UI) and JetBrains Mono (times/numbers)
  - primary: `oklch(0.52 0.2 280)`
  - "free" green: `oklch(0.72 0.15 155)`
  - destructive: `#E5484D`
  - text: `#17152A`
  - page background: `#F6F5FA`
  - borders: `#ECEAF2`
  - muted text: `#6B6880` / `#8A879C`
  - radii: roughly 8–16px
- **Phone layout:** the mobile reference is `Who's Free scheduling UI-2/Whos Free Phone.dc.html` (open `Whos Free Mobile.dc.html` to see every phone screen). Same rules as the desktop export: look, don't copy markup, don't edit or import it.
- **Phone navigation (FR-WEB-9):** follow the design on mobile **except** its bottom navigation bar. There is no bottom bar: navigation is a hamburger menu in the top header that opens a drawer (`MobileNav` in `apps/web/src/components/app/nav.tsx`). Don't add bottom bars or offsets for one.
- **Components:** use shadcn/ui (added through the shadcn CLI into `packages/ui` once it exists) and compose from those primitives. Don't hand-roll equivalents.
- **Icons:** use `lucide-react`. Don't create custom or inline SVG icons, and don't port the hand-drawn SVGs in the design export: map each one to the closest Lucide icon.
