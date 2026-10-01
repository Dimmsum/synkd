# whosfree — Issues

The single tracker for **everything that needs doing** on whosfree: features, setup, spikes, compliance tasks and **bugs**. Every issue lists what it **depends on**, so you can tell whether it's ready to start.

- Source of requirements: [PRD.md](PRD.md) (v0.6). The backend is **Supabase** (PRD D40, D41). Issues refer to PRD requirement IDs (`FR-…`, `NFR-…`) and decisions (`D…`).
- Last updated: 2026-09-30

---

## Contents
1. [How this file works](#1-how-this-file-works)
2. [Ready to start](#2-ready-to-start)
3. [Critical path](#3-critical-path)
   - [MVP milestones](#mvp-milestones)
4. [Index](#4-index)
5. [Issues by phase](#5-issues-by-phase)
   - [Phase 0: Foundations](#phase-0-foundations)
   - [Phase 1: Schedule import](#phase-1-schedule-import)
   - [Phase 2: Social & visibility](#phase-2-social--visibility)
   - [Phase 3: Availability & Now](#phase-3-availability--now)
   - [Phase 4: Google Calendar](#phase-4-google-calendar)
   - [Phase 5: Pings & slot finder](#phase-5-pings--slot-finder)
   - [Phase 6: PWA polish & beta](#phase-6-pwa-polish--beta)
6. [Bugs](#6-bugs)
7. [Templates](#7-templates)

---

## 1. How this file works

### IDs
- Every issue has a permanent ID: `WF-###`. **IDs are never reused or renumbered.**
- Numbers are grouped by phase (Phase 0 = 001–019, Phase 1 = 020–039, and so on). That makes an ID easy to place, but the gaps aren't meaningful.
- **New issues (including bugs) take the next free number after the highest existing ID.** The next free number is **WF-129**.
- Use the ID in branch names and commit messages, e.g. `feat(parser): recurring extraction (WF-028)`.

### Category (the kind of work)
| Category | Use for |
|---|---|
| `feature` | New functionality that users see |
| `bug` | Something that's broken or behaves differently from the PRD |
| `infra` | Build, deploy, environments, CI, hosting |
| `chore` | Setup or admin tasks with no product code (accounts, domains) |
| `spike` | A time-boxed investigation that ends in a **decision** (recorded in the PRD) |
| `security` | Security and privacy hardening, authorisation, redaction |
| `compliance` | Legal and regulatory work, Google verification |
| `test` | Test coverage, eval sets, test infrastructure |
| `research` | User research |
| `docs` | Documentation and help content |

### Area (the part of the system it touches)
`repo` · `web` · `backend` · `worker` · `parser` · `availability` · `social` · `gcal` · `ping` · `pwa` · `legal` · `ops`

### Priority
| Priority | Meaning | PRD MoSCoW |
|---|---|---|
| **P0** | Required for the MVP | Must |
| **P1** | In the MVP if time allows | Should |
| **P2** | After the MVP | Could |

### Milestone
| Milestone | Meaning |
|---|---|
| **A: Core loop** | The smallest version people can actually use: upload a schedule, add friends or join a group, see who's free, ping them. Goes to a small, trusted group of friends only. **Do these first.** |
| **Gate: Public-ready** | The safety, cost and legal work needed before **strangers** can use the app. Milestone A + Gate = **public launch** (PRD D39). |
| **B: MVP complete** | The rest of the P0 work: Google Calendar, the slot finder, data tooling, polish, and the closed beta. Can ship after the public launch. |
| **stretch** | P1 work. Only done if there's time, once its dependencies are finished. Not needed for the MVP. |

Rule: the order is **A → Gate → B → stretch**. An issue never depends on one from a later milestone (A depends only on A; Gate on A or Gate; B on anything except stretch). Check this whenever you add or move an issue.

### Status
| Status | Meaning |
|---|---|
| `todo` | Not started |
| `in-progress` | Being worked on |
| `blocked` | Can't move until a dependency or outside factor is resolved (say what in the issue) |
| `in-review` | Done, and being reviewed or tested |
| `done` | Acceptance criteria met and merged |
| `wontfix` | Decided against it (give the reason in the issue) |

### Dependencies
- **Depends on** lists the issues that must be `done` before this one can **start**.
- An issue is **ready** when every issue it depends on is `done`.
- If a dependency is only needed for *part* of an issue, the issue says so (e.g. "the ping part waits for WF-092").
- To find what an issue **unblocks**, search this file for its ID.

### Workflow
1. Pick an issue from [Ready to start](#2-ready-to-start), preferring **Milestone A** until it's finished.
2. Change its status to `in-progress` **in both places**: the index row and the issue itself.
3. When the acceptance criteria are met, change it to `done` and tick the boxes. **Keep finished issues in the file.** Don't delete them.
4. Update [Ready to start](#2-ready-to-start) with anything that just got unblocked.
5. Found a bug? Add it to [§6 Bugs](#6-bugs) using the [bug template](#bug-template) and add a row to the index.
6. If the scope changes, update the PRD first, then the issue.

---

## 2. Ready to start

These have no unfinished dependencies:

| ID | Title | Category |
|---|---|---|
| [WF-011](#wf-011--decide-final-name-and-register-domain) | Decide final name and register domain | `chore` |
| [WF-020](#wf-020--collect-20-real-schedule-samples-eval-set) | Collect 20+ real schedule samples (eval set) | `test` |
| [WF-119](#wf-119--jamaica-dpa-legal-review-and-oic-registration) | Jamaica DPA: legal review and OIC registration | `compliance` |
| [WF-122](#wf-122--user-research-interviews) | User research interviews | `research` |
| [WF-070](#wf-070--short-gap-rule) | Short-gap rule (stretch) | `feature` |
| [WF-050](#wf-050--pause-sharing) | Pause sharing (stretch; the column and redaction already exist) | `feature` |

**Milestone A code is merged** (2026-09-30). What's `in-review` is waiting for the owner's migrations, environment variables and a real run on a deploy and on phones: WF-004, 005, 006, 015, 026–032, 035, 040, 042–045, 047, 062, 063, 064, 068, 090–093, 111, 127. Still `in-progress`: WF-010 (legal values), WF-013 (OpenRouter settings), WF-037 (event and ping purges), WF-128 (slot-finder part, waits for WF-098). **Waiting on the owner:** WF-002 (hosting: Railway for now, Vercel is the PRD target), WF-003 (apply migrations), WF-006 (branch protection).

> WF-020 (collecting samples) still gates WF-023's model choice and WF-028's accuracy target. The parser runs on provisional models until then.

---

## 3. Critical path

This is the longest chain of dependencies to reach the closed beta. A delay anywhere on it delays the beta.

```
WF-001 Monorepo
  └─► WF-003 Supabase ─► WF-021 Shared schemas ──► WF-060 Availability engine ──► WF-061 Ranges & recurrence
        │                                                                           │
        └─► WF-004 Clerk auth ──► WF-040 Profiles ──► WF-043 Groups ──► WF-045 Invites & join
                                                                                    │
WF-020 Samples ──► WF-022 Eval harness ──► WF-023 Model spike ──► WF-027 Parse pipeline ──► WF-029 Review ──► WF-030 Commit
                                                                                    │
                                              WF-064 Now screen ◄───────────────────┘
                                                    │
                                              WF-092 Pings ──► WF-121 Closed beta
```

Google Calendar (Phase 4) runs **alongside** this path. Google's verification (WF-086) can take weeks, so start the prep (WF-012) early. Up to 100 test users don't need verification, so the beta can start without it.

### MVP milestones

The MVP is all **74 P0 issues**, delivered in three steps so that people can start using the app long before all 74 are finished: **A** (friends test), **Gate** (public launch), **B** (MVP complete).

#### Milestone A: Core loop (41 issues)
> *"I upload my schedule, add my friends or join their group, see who's free right now, and ping them."*

| Area | Issues |
|---|---|
| Foundations | WF-001, 002, 003, 004, 005, 006, 014 |
| Privacy basics | WF-010 (draft privacy/terms), 015 (consent record) |
| Parser | WF-013, 020, 021, 022, 023, 024, 025 |
| Schedule import | WF-026, 027, 028, 029, 030, 031 |
| **Friends** | WF-040 (profiles), 042 (friend requests + tier choice), 047 (block/remove) |
| **Offline friends** | WF-127 (add someone not on whosfree + import their timetable), 128 (show them on Now, detail, Find a time) |
| Groups & privacy | WF-041 (tiers + redaction), 043 (groups), 045 (invites + join) |
| Availability & Now | WF-060, 061, 062, 063, 064, 068 (onboarding) |
| Pings | WF-090, 091, 092, 093, 111 (install guide, needed for iOS push) |

**Milestone A is done when:** a small group of friends can each upload a schedule (and upload timetables for friends who aren't on the app yet), add each other as friends or join a group through an invite link, see each other on the Now screen at the tier they chose, and ping each other on Android and on installed iOS.

**What Milestone A doesn't include:** Google Calendar, the slot finder, group permissions, "Who can see me", rate limits, report/mute, data export/deletion, the legal review, the offline cache, and the security review. With a small, trusted test group, that's acceptable. **It isn't acceptable for anything public**, which is why the Gate comes next. (Google's 100-user cap doesn't apply here, because Milestone A never requests the calendar scope.)

#### Gate: Public-ready (7 issues)
> Milestone A + these = **OK to open to the public.**

| Issue | Why it's needed before strangers use the app |
|---|---|
| WF-035 Parse rate limiting | Stops one person draining the OpenRouter budget and breaking parsing for everyone |
| WF-044 Group member permissions | Lets admins remove strangers who joined through a forwarded invite link |
| WF-094 Ping rate limits, mute, quiet hours | Stops spam |
| WF-095 Report and block + moderation queue | Handles harassment through free-text pings |
| WF-119 Jamaica DPA legal review + OIC registration | A legal requirement. **Start early**, since it involves no code and may take a while. |
| WF-120 Security review | Tier redaction is the core promise |
| WF-126 Manual export/deletion process | Meets data rights by email until WF-113 and WF-114 are built |

**Gate is done when:** all 7 are `done`. The app can then launch publicly, and the rest of Milestone B ships afterwards.

#### Milestone B: MVP complete (26 issues)
Everything else at P0, which adds:
- **Google Calendar**: WF-012, 080, 081, 084, 086, 125 (titles only with T3)
- **Slot finder**: WF-098
- **Privacy extras**: WF-048 ("Who can see me")
- **Data and compliance**: WF-011, 037 (retention jobs), 113 (self-serve export), 114 (self-serve account deletion)
- **Polish and quality**: WF-007, 008, 009, 032, 033, 039, 065, 069, 110, 115, 116, 117
- **Launch**: WF-121 (closed beta), 122 (user research, which can start at any time)

**Milestone B is done when:** WF-121 has shipped, meaning the closed beta with 30–100 users in a seed community is live and the metrics in PRD §10 are being tracked.

---

## 4. Index

| ID | Title | Category | Area | Pri | Phase | Milestone | Status | Depends on |
|---|---|---|---|---|---|---|---|---|
| WF-001 | Initialise repo and Turborepo monorepo | chore | repo | P0 | 0 | A | done | — |
| WF-002 | Scaffold Next.js web app | infra | web | P0 | 0 | A | blocked | 001 |
| WF-003 | Set up Supabase backend package | infra | backend | P0 | 0 | A | blocked | 001 |
| WF-004 | Clerk auth with Google + Supabase integration | feature | backend, web | P0 | 0 | A | in-review | 002, 003 |
| WF-005 | Age gate (date of birth at sign-up) | feature | web, backend | P0 | 0 | A | in-review | 004 |
| WF-006 | CI pipeline (lint, typecheck, test) | infra | repo | P0 | 0 | A | in-review | 001 |
| WF-007 | Environments and preview deploys | infra | ops | P0 | 0 | B | todo | 002, 003 |
| WF-008 | Sentry and PostHog | infra | ops | P0 | 0 | B | todo | 002 |
| WF-009 | Landing page | feature | web | P0 | 0 | B | todo | 002 |
| WF-010 | Privacy policy, terms, contact pages | compliance | legal, web | P0 | 0 | A | in-progress | 002 |
| WF-011 | Decide final name and register domain | chore | ops | P0 | 0 | B | todo | — |
| WF-012 | Google Cloud project and OAuth consent screen | chore | gcal | P0 | 0 | B | todo | 010, 011 |
| WF-013 | Set up OpenRouter account and data policy | chore | parser | P0 | 0 | A | in-progress | — |
| WF-014 | Signed-in app shell, navigation, 404/error pages | feature | web | P0 | 0 | A | done | 004 |
| WF-015 | Consent record (versioned terms/privacy acceptance) | compliance | backend | P0 | 0 | A | in-review | 004, 010 |
| WF-020 | Collect 20+ real schedule samples (eval set) | test | parser | P0 | 1 | A | todo | — |
| WF-021 | Shared schemas package (event draft, statuses, tiers) | feature | repo | P0 | 1 | A | done | 001 |
| WF-022 | Parser eval harness | test | parser | P0 | 1 | A | done | 013, 020, 021 |
| WF-023 | Spike: compare vision models via OpenRouter | spike | parser | P0 | 1 | A | todo | 022 |
| WF-024 | Spike: Vercel functions vs Railway worker | spike | worker | P0 | 1 | A | done | 002 |
| WF-025 | Scaffold worker service (Hono, Railway, HMAC) | infra | worker | P0 | 1 | A | wontfix | 001, 024 |
| WF-026 | File upload, validation and `scheduleFiles` | feature | web, backend | P0 | 1 | A | in-review | 003, 014 |
| WF-027 | Parse job pipeline (queue, worker call, callback, retries) | feature | backend, worker | P0 | 1 | A | in-review | 023, 025, 026 |
| WF-028 | Recurring schedule extraction | feature | parser | P0 | 1 | A | in-review | 027 |
| WF-029 | Review screen (grid, confidence, side-by-side, editing) | feature | web | P0 | 1 | A | in-review | 021, 027 |
| WF-030 | Commit schedule to events (RRULE, date range, exceptions) | feature | backend | P0 | 1 | A | in-review | 029 |
| WF-031 | Manual schedule entry | feature | web | P0 | 1 | A | in-review | 029 |
| WF-032 | Pending uploads list (view, delete) | feature | web | P0 | 1 | B | in-review | 026 |
| WF-033 | Re-upload and schedule replacement | feature | backend, web | P0 | 1 | B | todo | 030 |
| WF-034 | Re-parse a stored file | feature | backend | P1 | 1 | stretch | wontfix | 027 |
| WF-035 | Parse rate limiting | security | backend | P0 | 1 | Gate | in-review | 027 |
| WF-036 | Dated schedules (rosters) | feature | parser | P1 | 1 | stretch | todo | 023, 028 |
| WF-037 | Retention jobs (files, events, pings) | compliance | backend | P0 | 1 | B | in-progress | 026, 030 |
| WF-038 | Camera capture on upload | feature | web | P1 | 1 | stretch | todo | 026 |
| WF-039 | Run parser evals in CI | test | parser | P0 | 1 | B | todo | 006, 022 |
| WF-040 | Profiles and handles | feature | social | P0 | 2 | A | in-review | 004 |
| WF-041 | Visibility tiers and server-side redaction | security | backend | P0 | 2 | A | done | 003, 021 |
| WF-042 | Friend requests with tier choice | feature | social | P0 | 2 | A | in-review | 040, 041 |
| WF-043 | Groups: create, edit, admin role, 20-member cap | feature | social | P0 | 2 | A | in-review | 040 |
| WF-044 | Group member permissions | feature | social | P0 | 2 | Gate | in-review | 043 |
| WF-045 | Invite links, invite page and join flow | feature | social, web | P0 | 2 | A | in-review | 041, 043 |
| WF-046 | WhatsApp share and link previews | feature | web | P1 | 2 | stretch | todo | 045 |
| WF-047 | Block, remove friend, leave group | feature | social | P0 | 2 | A | in-review | 042, 043 |
| WF-048 | "Who can see me" page and overlap hint | feature | web | P0 | 2 | B | todo | 041, 042, 043 |
| WF-049 | "How others see me" preview | feature | web | P1 | 2 | stretch | todo | 048, 061 |
| WF-050 | Pause sharing | feature | backend, web | P1 | 2 | stretch | todo | 041 |
| WF-060 | Availability engine core | feature | availability | P0 | 3 | A | done | 021 |
| WF-061 | Recurrence expansion and multi-user free intervals | feature | availability | P0 | 3 | A | done | 060 |
| WF-062 | Available hours (onboarding slider and settings) | feature | web, backend | P0 | 3 | A | in-review | 014, 060 |
| WF-063 | Manual status override | feature | web, backend | P0 | 3 | A | in-review | 060 |
| WF-064 | Now screen (real-time, redacted) | feature | web, backend | P0 | 3 | A | in-review | 041, 042, 043, 061 |
| WF-065 | Friend detail and My schedule views | feature | web | P0 | 3 | B | todo | 064 |
| WF-066 | Group timeline view | feature | web | P1 | 3 | stretch | todo | 064 |
| WF-067 | Stale-data warning | feature | web, backend | P1 | 3 | stretch | todo | 064 |
| WF-068 | End-to-end onboarding flow | feature | web | P0 | 3 | A | in-review | 005, 030, 045, 062 |
| WF-069 | Empty states and "nudge to add schedule" | feature | web | P0 | 3 | B | todo | 064 |
| WF-070 | Short-gap rule | feature | availability | P1 | 3 | stretch | todo | 060 |
| WF-080 | Google Calendar OAuth (own flow, encrypted tokens) | feature | gcal | P0 | 4 | B | todo | 003, 004, 012 |
| WF-081 | Calendar selection and initial sync | feature | gcal | P0 | 4 | B | todo | 060, 080 |
| WF-082 | Incremental sync, watch channels, polling fallback | feature | gcal | P1 | 4 | stretch | todo | 081 |
| WF-083 | Private calendars and events | feature | gcal | P1 | 4 | stretch | todo | 041, 081 |
| WF-084 | Disconnect Google Calendar and delete data | feature | gcal | P0 | 4 | B | todo | 080 |
| WF-085 | Sync health UI | feature | web | P1 | 4 | stretch | todo | 082 |
| WF-086 | Submit Google OAuth verification | compliance | gcal | P0 | 4 | B | todo | 010, 012, 080 |
| WF-087 | Handle Google accounts managed by an organisation | feature | gcal | P1 | 4 | stretch | todo | 080 |
| WF-090 | PWA manifest and service worker (Serwist) | infra | pwa | P0 | 5 | A | in-review | 002 |
| WF-091 | Web Push infrastructure | infra | pwa, backend | P0 | 5 | A | in-review | 004, 090 |
| WF-092 | Send pings and inbox | feature | ping | P0 | 5 | A | in-review | 064, 091 |
| WF-093 | Ping replies | feature | ping | P0 | 5 | A | in-review | 092 |
| WF-094 | Ping rate limits, mute, quiet hours | security | ping | P0 | 5 | Gate | todo | 092 |
| WF-095 | Report and block, plus moderation queue | security | ping, backend | P0 | 5 | Gate | todo | 047, 092 |
| WF-096 | Group ping | feature | ping | P1 | 5 | stretch | todo | 044, 092 |
| WF-097 | Ping expiry | feature | ping | P1 | 5 | stretch | todo | 092 |
| WF-098 | Group slot finder | feature | availability, web | P0 | 5 | B | todo | 043, 061 |
| WF-099 | Share a slot | feature | web | P1 | 5 | stretch | todo | 096, 098 |
| WF-110 | Offline cache of last-known Now | feature | pwa | P0 | 6 | B | todo | 064, 090 |
| WF-111 | Install prompt and iOS guide | feature | pwa | P0 | 6 | A | in-review | 090 |
| WF-112 | App update flow | feature | pwa | P1 | 6 | stretch | todo | 090 |
| WF-113 | Export my data | compliance | backend | P0 | 6 | B | todo | 030, 042, 092 |
| WF-114 | Delete my account | compliance | backend | P0 | 6 | B | todo | 030, 043, 080 |
| WF-115 | Notification settings | feature | web | P0 | 6 | B | todo | 091 |
| WF-116 | Accessibility audit (WCAG 2.1 AA) | test | web | P0 | 6 | B | todo | 064, 092, 098 |
| WF-117 | Performance budget check | test | web | P0 | 6 | B | todo | 009, 064 |
| WF-118 | Admin view and feature flags | feature | ops | P1 | 6 | stretch | todo | 004 |
| WF-119 | Jamaica DPA: legal review and OIC registration | compliance | legal | P0 | 6 | Gate | todo | — |
| WF-120 | Security review (authorisation and redaction tests) | security | backend | P0 | 6 | Gate | todo | 041, 064, 092 |
| WF-121 | Closed beta launch | chore | ops | P0 | 6 | B | todo | 068, 092, 098, 110, 111, 119, 120 |
| WF-122 | User research interviews | research | — | P0 | 6 | B | todo | — |
| WF-123 | Help / FAQ pages | docs | web | P1 | 6 | stretch | todo | 111 |
| WF-124 | Schedule-expiry reminder | feature | backend | P1 | 6 | stretch | todo | 030, 091 |
| WF-125 | Google event titles only while a T3 grant exists | security | gcal | P0 | 4 | B | todo | 041, 081 |
| WF-126 | Manual export/deletion request process | compliance | legal | P0 | 6 | Gate | todo | 010 |
| WF-127 | Offline friends: add someone not on whosfree and import their timetable | feature | social, backend, web | P0 | 2 | A | in-review | 030, 031 |
| WF-128 | Show offline friends on Now, detail page and Find a time | feature | web, availability | P0 | 3 | A | in-progress | 064, 127 |

---

## 5. Issues by phase

### Phase 0: Foundations

#### WF-001 · Initialise repo and Turborepo monorepo
- **Category:** `chore` · **Area:** `repo` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** —
- **PRD:** §8.2, D6

Initialise git and set up a pnpm workspace with Turborepo, following the layout in PRD §8.2. Add `packages/config` with shared tsconfig (strict), eslint and prettier.

**Acceptance criteria**
- [x] `git init` done, `.gitignore` includes `.env*`, `node_modules` and `.turbo`
- [x] `pnpm-workspace.yaml` and `turbo.json` define `build`, `dev`, `lint`, `typecheck` and `test` pipelines
- [x] `packages/config` exports base tsconfig and eslint configs, with `strict: true` (NFR-OPS-1)
- [x] `pnpm lint` and `pnpm typecheck` run from the root

#### WF-002 · Scaffold Next.js web app
- **Category:** `infra` · **Area:** `web` · **Priority:** P0 · **Milestone:** A · **Status:** `blocked`
- **Depends on:** WF-001
- **PRD:** §8.2, §8.4

Create `apps/web` (Next.js App Router, Tailwind, shadcn/ui) and `packages/ui`.

> Merged: Next.js 16 app and `packages/ui` with every Milestone A screen on mock data (`apps/web/src/lib/data/*` and `lib/actions/*` are the wiring points, ~100 `TODO(WF-…)` markers). Loads the repo-root `.env`. **Blocked on the owner:** connecting the repo to Vercel.
>
> **For now the owner is deploying to Railway** (2026-09-30): `railway.json` at the repo root builds with Railpack (`pnpm --filter @whosfree/web build`, then `next start` on `$PORT`, health check `/offline`). Vercel is still the PRD target (§8.4); record a decision before making Railway permanent.

**Acceptance criteria**
- [x] `apps/web` runs locally with `pnpm dev`
- [x] Tailwind and shadcn/ui are configured, and shared components live in `packages/ui`
- [x] Light and dark themes follow the system setting (NFR-UX-3)
- [ ] Deploys to Vercel from the repo

#### WF-003 · Set up Supabase backend package
- **Category:** `infra` · **Area:** `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `blocked`
- **Depends on:** WF-001
- **PRD:** §8.1, §8.2, §9, D40, D41

Create `packages/backend` holding the Supabase project (`supabase/` with `config.toml` and SQL migrations), with dev and prod projects.

> Everything except the hosted project is done: migrations in `packages/backend/supabase/migrations`, PGlite tests with a Supabase shim, and types generated by the real Supabase CLI (`pnpm --filter @whosfree/backend db:types`; a test fails if they drift). Once the project exists, run a smoke test against it.
>
> **Hosted project: `init.sql` applied on 2026-09-30** (every migration through `20261002300100_offline_friends_isolation.sql`). Apply later migrations one by one, in filename order.
>
> **Migrations are applied by hand by the owner.** `packages/backend/supabase/init.sql` bundles every migration in one transaction for a fresh project; for an existing project, apply only the new migration files in order. After adding or changing a migration, run `pnpm --filter @whosfree/backend db:generate` (types + init.sql); tests fail if either is stale.

**Acceptance criteria**
- [x] `supabase/` is initialised in the package, and the migrations apply cleanly to a fresh database
- [x] The first migration creates the `users` table (PRD §9) with RLS enabled, plus the `current_user_id()` helper that maps the Clerk user ID in the token to `users.id`
- [x] TypeScript database types are generated from the schema and exported from `packages/backend` (`apps/web` imports them once WF-002 exists)
- [x] Database tests run in Vitest against PGlite with a Supabase auth shim, with at least one passing RLS test
- [ ] A Supabase dev project is created and linked, and Clerk is added as a third-party auth provider (**blocked on the owner**: create the Supabase and Clerk projects, then enable `[auth.third_party.clerk]` in `supabase/config.toml` and in the dashboard)

#### WF-004 · Clerk auth with Google + Supabase integration
- **Category:** `feature` · **Area:** `backend`, `web` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-002, WF-003
- **PRD:** FR-AUTH-1, FR-AUTH-3, FR-AUTH-5, FR-WEB-2, D19, D45

Google or email-and-password sign-in (D45) through Clerk, connected to Supabase through **third-party auth** (Supabase validates Clerk session tokens), and a `users` row created on first sign-in. Sign-in asks for **basic scopes only**, with no calendar scopes.

> From WF-003/041: clients can't insert `users` rows. Create them server-side (a Clerk webhook using the service role, or a security-definer function that reads `auth.jwt()->>'sub'`), with a name of 1–100 characters and a valid timezone. Clerk session tokens must carry `role: "authenticated"`.

> Backend done (merged): `ensure_current_user(name, avatar_url, timezone)` creates the row on first sign-in (idempotent, Clerk ID from the token only) and `account_status()` tells middleware what's missing. Left: Clerk pages, calling these from the server, and middleware.

> Web merged: `<SignIn>`/`<SignUp>` (hash routing, themed), `apps/web/src/proxy.ts` gating by `account_status()` (rules in `lib/auth/gate.ts`, unknown paths denied by default; public: `/`, legal, `/contact`, `/help`, `/i/*`, PWA files), `ensure_current_user` on first sign-in (timezone from a `wf_tz` cookie, falling back to `America/Jamaica`). **`createServerSupabase()` in `lib/supabase/server.ts` is the only way to reach Supabase**: it sends the user's Clerk token and never the secret key. `/api/*` isn't gated, so route handlers check their own auth. **Waiting on the owner for a live check:** apply migrations, Clerk → Supabase integration, Supabase third-party auth, Google-only sign-in, component paths `/sign-in` `/sign-up` and after-sign-out `/`. Known gaps: under-18 users keep their users row and Clerk user (only signed out) until WF-114; onboarding completion isn't gated (no flag).

**Acceptance criteria**
- [x] `/sign-in` and `/sign-up` use Clerk components
- [x] The first sign-in creates a `users` row (`clerkId`, name, avatar, timezone defaulting to `America/Jamaica`)
- [x] RLS policies and database functions identify the user from the Clerk token (`auth.jwt()->>'sub'`), and requests without a valid token can't read or write anything
- [ ] The session survives closing and reopening the app

#### WF-005 · Age gate (date of birth at sign-up)
- **Category:** `feature` · **Area:** `web`, `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-004
- **PRD:** FR-AUTH-6, NFR-COMP-7, D13, D29

> Backend done (merged): `checkAge` / `localDateIn` in `@whosfree/shared` (today = the Jamaica calendar date; 29 Feb birthdays count from 1 Mar), then `confirm_age(birth_year)` with the user's own token. Write-once. Left: the web form and middleware.

> Web merged: `/sign-up/age` → `confirmAge` action (full date stays in the action; only `birth_year` is sent), `/sign-up/not-eligible` signs the user out. Boundary tests are the shared ones in `packages/shared/src/age.test.ts` (the web duplicate was removed). Needs the live check with WF-004.

**Acceptance criteria**
- [x] Sign-up asks for a date of birth, and anyone under 18 is blocked with a clear message
- [x] Only `birthYear` and `ageConfirmedAt` are stored. The full date of birth never reaches the database.
- [x] App routes are inaccessible until the age is confirmed
- [x] Unit tests cover the boundaries (someone turning 18 today, and someone turning 18 tomorrow)

#### WF-006 · CI pipeline (lint, typecheck, test)
- **Category:** `infra` · **Area:** `repo` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-001
- **PRD:** §8.4, NFR-SEC-10

`.github/workflows/ci.yml` runs format check, lint, typecheck and test (with the Turborepo cache) plus a gitleaks secret scan. Dependabot version updates (`.github/dependabot.yml`), Dependabot alerts and security fixes, secret scanning and push protection are on. Only branch protection is left.

**Acceptance criteria**
- [x] GitHub Actions runs lint, typecheck and test on every PR, using the Turborepo cache
- [x] Dependabot or Renovate is enabled, and secret scanning is on
- [ ] Branch protection on `main` requires CI to pass (**owner decision**: it will stop direct pushes to `main`)

#### WF-007 · Environments and preview deploys
- **Category:** `infra` · **Area:** `ops` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-002, WF-003
- **PRD:** NFR-OPS-6

**Acceptance criteria**
- [ ] `dev`, `preview` (one per PR) and `prod` environments, each with its own Supabase project and Clerk instance
- [ ] Each PR gets a Vercel preview URL wired to a Supabase preview branch
- [ ] Environment variables are documented in `.env.example`

#### WF-008 · Sentry and PostHog
- **Category:** `infra` · **Area:** `ops` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-002
- **PRD:** NFR-OPS-4, NFR-OPS-5, NFR-SEC-11, NFR-SEC-12, D37

**Acceptance criteria**
- [ ] Sentry captures errors from web (and from the worker once WF-025 exists), with `sendDefaultPii: false` and IP storage disabled in the project settings
- [ ] PostHog records page views and key events with **IP capture turned off**, and with **no event titles, ping text or schedule contents**
- [ ] A correlation ID helper exists in `packages/shared`

#### WF-009 · Landing page
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-002
- **PRD:** FR-WEB-1, NFR-PERF-1

**Acceptance criteria**
- [ ] A static `/` page covers what the app is, a three-step "how it works", the privacy promise, a sign-up button and install instructions
- [ ] Signed-in users are redirected to `/now`
- [ ] LCP ≤ 2.5 s on Fast 3G (Lighthouse mobile)

#### WF-010 · Privacy policy, terms, contact pages
- **Category:** `compliance` · **Area:** `legal`, `web` · **Priority:** P0 · **Milestone:** A · **Status:** `in-progress`
- **Depends on:** WF-002 (only for turning the drafts into pages)
- **PRD:** FR-WEB-4, NFR-COMP-4, NFR-COMP-5, NFR-COMP-8, D35–D38

The drafts are written: [docs/legal/privacy-policy.md](docs/legal/privacy-policy.md) and [docs/legal/terms.md](docs/legal/terms.md). What's left is filling in the placeholders and showing them as pages on the site. A lawyer reviews them in WF-119.

> Merged: `/privacy` and `/terms` render `docs/legal/*.md` at build time (static), `/contact` has no form, and the drafts cover offline friends (D44). **Every open value is in `apps/web/src/lib/legal.ts` (`LEGAL_VALUES`)**: the entity name, registered address, domain, effective date, the privacy/support/security emails, DPO, OIC contact, four retention periods and the liability cap. Until they're filled in, they render highlighted and the pages show a draft banner. One version, `LEGAL_VERSION = '0.1-draft'`, matches `current_consent_version()`, and a test fails if they drift. A bump = new text + new `LEGAL_VERSION` + a migration replacing `current_consent_version()`. **Left (owner):** supply the values, mostly after WF-011 and WF-119.

**Acceptance criteria**
- [x] Draft privacy policy covers what we collect, what we *don't* collect, why, retention (files deleted on confirm, events 90 days, pings 30 days), the processors we use, sending data abroad, the **Google Limited Use** disclosure, and user rights
- [x] Draft terms cover the 18+ rule, acceptable use, pings, groups and admins, parsing accuracy, and Jamaican law
- [ ] Every `[PLACEHOLDER]` filled in (legal entity, contact email, domain, effective date)
- [x] Shown at `/privacy` and `/terms`
- [x] `/contact` is a contact page
- [x] Each document has a version number (used by WF-015)
- [x] The drafts cover offline friends (D44): the privacy policy explains we hold a nickname and schedule for people who aren't users, only for the user who added them; the terms require their permission

#### WF-011 · Decide final name and register domain
- **Category:** `chore` · **Area:** `ops` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** —
- **PRD:** D23, NFR-COMP-6

"whosfree" is a working name. The final name must be decided **before** the Google verification submission (WF-086), because rebranding afterwards may trigger a new review.

**Acceptance criteria**
- [ ] Final name chosen, with a basic trademark and social-handle check done
- [ ] Domain registered and pointed at Vercel
- [ ] PRD D23 updated

#### WF-012 · Google Cloud project and OAuth consent screen
- **Category:** `chore` · **Area:** `gcal` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-010, WF-011
- **PRD:** NFR-COMP-6, D8

**Acceptance criteria**
- [ ] Google Cloud project created, with the Calendar API enabled
- [ ] OAuth consent screen set up (app name, domain, privacy and terms URLs, `calendar.readonly` scope)
- [ ] Domain verified in Search Console
- [ ] Test users added (up to 100)

#### WF-013 · Set up OpenRouter account and data policy
- **Category:** `chore` · **Area:** `parser` · **Priority:** P0 · **Milestone:** A · **Status:** `in-progress`
- **Depends on:** —
- **PRD:** D15, NFR-SEC-8

> Owner (2026-09-30): the API key is stored. **Left (owner):** confirm the spend limit and that zero data retention is on, and allow the Mistral and Google Vertex providers (the provisional models, WF-023).

**Acceptance criteria**
- [x] OpenRouter account and API key created and stored in a secret manager (never committed)
- [ ] Settings exclude providers that store or train on prompts. Document what OpenRouter actually guarantees.
- [ ] Spend limit set on the account

#### WF-014 · Signed-in app shell, navigation, 404/error pages
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** WF-004
- **PRD:** §8.3, FR-WEB-8, NFR-UX-2

**Acceptance criteria**
- [x] A signed-in layout with navigation to Now, Schedule, Friends, Groups, Find a time, Inbox and Settings: the sidebar on desktop, and on phones a **hamburger menu** in the header that opens a drawer (FR-WEB-9; no bottom bar, owner decision 2026-09-30)
- [x] Placeholder routes from PRD §8.3 exist and are protected
- [x] The 404 and error pages point people somewhere useful
- [x] Tap targets are at least 44×44 px

#### WF-015 · Consent record (versioned terms/privacy acceptance)
- **Category:** `compliance` · **Area:** `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-004, WF-010
- **PRD:** FR-SET-5

> Backend done (merged): `current_consent_version()`, `accept_consent(version)`, `account_status().consent_required`. **Bumping the version is a migration** that ships with the new legal text. Left: web wiring.

> Web merged: `/sign-up/terms` sends the version from `account_status().current_consent_version` (not a web constant) to `accept_consent`. The proxy sends anyone with `consent_required` back to it ("We've updated our terms"). The displayed version is `LEGAL_VERSION` in `apps/web/src/lib/legal.ts` (WF-010), and a test keeps it equal to the DB. Settings shows the consent record from the users row. Needs the live check with WF-004.

**Acceptance criteria**
- [x] Sign-up records `consentVersion` and `consentAt`
- [x] When the policy version changes, the user must accept again on their next visit

---

### Phase 1: Schedule import

#### WF-020 · Collect 20+ real schedule samples (eval set)
- **Category:** `test` · **Area:** `parser` · **Priority:** P0 · **Milestone:** A · **Status:** `todo`
- **Depends on:** —
- **PRD:** §13 next steps, R1, D7, D11

**The most important early task.** Gather a varied set of real schedules, with permission, and anonymise them.

**Acceptance criteria**
- [ ] 20+ samples, including university timetables (UWI, UTech, NCU and others), high-school timetables, **work rosters and shift schedules**, portal screenshots, and photos of printed sheets (some skewed or poorly lit)
- [ ] Each one has a hand-written `expected.json` in the event draft schema (WF-021)
- [ ] Stored in `evals/schedules/`. Kept out of git if anything sensitive remains.
- [ ] Consent recorded for each contributor

#### WF-021 · Shared schemas package (event draft, statuses, tiers)
- **Category:** `feature` · **Area:** `repo` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** WF-001
- **PRD:** §6.6, §6.7, §9, NFR-OPS-1

`packages/shared`: zod schemas and types shared by web, backend, worker and parser.

**Acceptance criteria**
- [x] `EventDraft` schema: title, category, start/end, recurrence (weekly, alternating, week numbers) or a specific date, and confidence
- [x] Constants for statuses (`free`, `busy`, `dnd`, `away`, `no_schedule`, `paused`), tiers (1–3), group permissions and ping templates
- [x] **No location field** (D35)
- [x] Unit tests for the schema edge cases

#### WF-022 · Parser eval harness
- **Category:** `test` · **Area:** `parser` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** WF-013, WF-020, WF-021
- **PRD:** NFR-OPS-3, FR-ADM-3

A script in `packages/parser` that runs a model and prompt against the eval set and scores the results.

> Merged, built ahead of WF-013/WF-020 (no live call made yet; the first real run is WF-023). `packages/parser`: `parseSchedule` through OpenRouter (validated with the shared `ParseDraft`, `data_collection: deny`, ZDR on by default, temperature 0), scoring (recall/precision/F1, exact and ±5 min times, recurrence, an edit-count estimate for "≤ 3 edits"), and a CLI: `pnpm --filter @whosfree/parser eval:check`, `eval --model <id> --prompt v1`, `eval:compare`. Samples go in `evals/schedules/` (gitignored) as `<name>.<ext>` + `<name>.expected.json`; results in `packages/parser/eval/results/` (gitignored). See `packages/parser/eval/README.md`. **For WF-027/028:** zod strips location *fields* but not a room typed into a title, so D35 needs a post-processing check there. **For WF-039:** there's no CI gate or baseline yet.

**Acceptance criteria**
- [x] Scores each sample on event recall and precision, time accuracy, recurrence accuracy, and an estimate of "≤ 3 edits needed"
- [x] Reports cost and latency per sample (from OpenRouter)
- [x] Results saved in a form that can be compared across runs

#### WF-023 · Spike: compare vision models via OpenRouter
- **Category:** `spike` · **Area:** `parser` · **Priority:** P0 · **Milestone:** A · **Status:** `todo`
- **Depends on:** WF-022
- **PRD:** D15, NFR-COST-1, NFR-PERF-4

> Provisional until there are samples (WF-020): primary `mistralai/mistral-small-2603`, fallback `google/gemini-3.1-flash-lite` (`packages/shared` constants, `PARSER_VERSION = 1.0+prompt.v2`). One smoke test on a synthetic timetable validated exactly (US$0.0005, 4 s). Two other candidates had no zero-data-retention endpoint that takes `temperature`. The fallback hasn't been seen to answer yet.

**Acceptance criteria**
- [ ] 2–3 vision models with structured output compared on the eval set
- [ ] A chosen **primary model and fallback model**, recorded in the PRD decision log
- [ ] Evidence it can reach **≥ 70% parse acceptance**, at a cost of about ≤ US$0.05 per parse and p95 ≤ 60 s. If it can't, say what would need to change.

#### WF-024 · Spike: Vercel functions vs Railway worker
- **Category:** `spike` · **Area:** `worker` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** WF-002
- **PRD:** §8.1, D6, R8

Can Vercel (Node) functions on the Next.js server handle PDF rasterisation and HEIC conversion within their limits?

> Spike done: [docs/spikes/WF-024-vercel-vs-worker.md](docs/spikes/WF-024-vercel-vs-worker.md). **Recommendation: drop the worker** (medium-high confidence). PDFium (WASM) + libheif (WASM) + sharp convert every FR-IMP-1 input in about 0.02–3.3 s locally, under 1 GB of memory, adding about 25 MB to the function, with no custom binaries. Vercel's 4.5 MB body limit means uploads must go straight to Supabase Storage through a signed upload URL (affects WF-026). The prototype route is on branch `spike/wf-024` (not merged; gated to 404 in production without `SPIKE_WF024_TOKEN`). **Left (owner):** run the write-up's §10 checklist on a Vercel preview of that branch, then decide. If it passes: record D46 in the PRD (text in the report), set WF-025 to `wontfix`, move `convert.ts` into the parser for WF-027, and delete the spike route.

> **Decided (owner, 2026-09-30): drop the worker** (D46, PRD v0.12). The §10 Vercel checklist was skipped (the app runs on Railway for now, where none of Vercel's limits apply), so the first criterion stays open as accepted risk. The converter moved to `@whosfree/parser/node` (exact pins, magic bytes, ~50 MP HEIC cap, PDF page caps, `limitInputPixels`, one conversion at a time); the spike route was never merged. A production build traces the PDFium WASM and keeps sharp external.

- [ ] A prototype of PDF → image and HEIC → JPEG inside a Next.js route handler deployed on Vercel
- [x] Documented limits (runtime, memory, native dependencies)
- [x] A decision recorded in the PRD: keep the worker or drop it. **If it's dropped, WF-025 becomes `wontfix`** and WF-027 calls OpenRouter from the Next.js server instead.

#### WF-025 · Scaffold worker service (Hono, Railway, HMAC)
- **Category:** `infra` · **Area:** `worker` · **Priority:** P0 · **Milestone:** A · **Status:** `wontfix`
- **Depends on:** WF-001, WF-024
- **PRD:** §8.1, NFR-SEC-5, NFR-SEC-8, NFR-SCALE-2

> Wontfix: there is no worker (D46, WF-024). Parse runs happen on the Next.js server behind a `CRON_SECRET`-authenticated internal route.

**Acceptance criteria**
- [ ] `apps/worker` is a Node + Hono service with a Dockerfile, deployed on Railway
- [ ] Every request has an HMAC signature and timestamp checked. Unsigned requests or replays are rejected.
- [ ] The OpenRouter key exists only in the worker's environment
- [ ] `/health` endpoint, Sentry wired in, and no state kept between requests

#### WF-026 · File upload, validation and `scheduleFiles`
- **Category:** `feature` · **Area:** `web`, `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-003, WF-014
- **PRD:** FR-IMP-1, FR-IMP-15, NFR-SEC-6, NFR-PERF-6, D38

> Merged (migration `20261003500000_schedule_files_and_parse_jobs.sql`): `create_schedule_upload(...)` registers the file (server-chosen path `<user>/<file>`, 10 pending max, 20/day) and the browser uploads straight to the private `schedule-files` bucket through a signed upload URL. Images are shrunk on the device to ≤ 2000 px; the server sniffs magic bytes before converting; the original is shown through a 60 s signed URL after an RLS ownership check. **Left:** a live run once the migration is applied (check the bucket row: private, 10 MB, PDF and image types).

**Acceptance criteria**
- [x] Accepts PDF, PNG, JPG, HEIC and WebP up to 10 MB, and PDFs up to 5 pages
- [x] Files are checked by their magic bytes on the server, not just their extension
- [x] Images are compressed on the device to ≤ 2000 px
- [x] A `scheduleFiles` row is created with `sha256`, and with `deleteAt = uploadedAt + 7 days` (the fallback for files that are never confirmed)
- [x] Storage is private and files are only reachable through short-lived URLs

#### WF-027 · Parse job pipeline (queue, worker call, callback, retries)
- **Category:** `feature` · **Area:** `backend`, `worker` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-023, WF-025, WF-026
- **PRD:** §8.5, FR-IMP-13, FR-IMP-14, NFR-REL-2, NFR-REL-4, NFR-SEC-7

> Merged (D46, no worker): `start_parse_job` (5/day, WF-035) → dispatch to `/api/internal/parse-jobs/run` (Bearer `CRON_SECRET`), which claims with a lease, converts in memory, makes one model call and calls `complete_parse_job`/`fail_parse_job` (backoff 1 min then 5 min, 3 attempts, fallback model). `/api/internal/parse-jobs/sweep` re-dispatches due jobs, expires files and drains `storage_removals`. Live progress through a `parse_job_changed` signal. The "signed worker call and callback" criterion is met by the internal route instead. **Left (owner):** set `CRON_SECRET`, and a cron calling the sweep every minute (POST or GET with `Authorization: Bearer <CRON_SECRET>`).

**Acceptance criteria**
- [x] `parseJobs` status moves through queued → processing → needs_review, or failed
- [x] The Next.js server calls the worker with a signed request, and the worker's signed callback (to a server route handler) updates the job. A cron re-dispatches jobs left in `queued`.
- [x] Jobs can be repeated safely (idempotent), with up to 3 retries using backoff and OpenRouter's fallback model
- [x] Model output is validated with zod, and nothing from it is executed or rendered as HTML
- [x] `model`, `parserVersion` and `costUsd` are recorded on the job
- [x] The UI shows live progress, and failures show retry, try another file, or enter manually

#### WF-028 · Recurring schedule extraction
- **Category:** `feature` · **Area:** `parser` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-027
- **PRD:** FR-IMP-3, FR-IMP-4, FR-IMP-5, D7

> Merged: prompt v2 (grids either way, lists, weekly / A-B / odd-even / week numbers, suggested period, per-event confidence) and a title scrubber for D35 (rooms with a keyword, names with honorifics, IDs, emails, links, phones, addresses). A bare room like "SLT 2" or a bare name can't be caught. **Left:** the ≥ 70 % target needs the eval set (WF-020) and model choice (WF-023).

**Acceptance criteria**
- [x] Handles grids with days as columns or as rows, and list layouts
- [x] Detects weekly, alternating-week (A/B or odd/even) and specific-week-number patterns
- [x] Suggests the schedule's date range when the file contains dates
- [x] Confidence is scored for each event
- [ ] Rooms, addresses, ID numbers, names and photos in the file are **ignored and never output** (D35)
- [ ] ≥ 70% acceptance on the recurring part of the eval set

#### WF-029 · Review screen (grid, confidence, side-by-side, editing)
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-021, WF-027
- **PRD:** FR-IMP-9, FR-IMP-10, FR-IMP-11, G1

> Merged: the review grid highlights low-confidence events and shows the original next to it (stacked with a toggle on phones; HEIC previews only in Safari). Edit, delete, add, split (by day or in two) and merge; the editor also keeps specific weeks and one-off dates. **Left:** measure time to confirm in testing.

**Acceptance criteria**
- [x] A week-grid preview, with low-confidence events highlighted
- [x] The original file is shown next to the grid (stacked on mobile, with a toggle)
- [x] Events can be edited, deleted, added, split and merged, using an **event editor component that can be reused** (WF-031 needs it)
- [x] Nothing is saved to the schedule until the user taps Confirm
- [ ] Median time from upload to confirm is ≤ 3 minutes in testing

#### WF-030 · Commit schedule to events (RRULE, date range, exceptions)
- **Category:** `feature` · **Area:** `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-029
- **PRD:** FR-IMP-7, FR-IMP-8, §9 modelling decision

> Merged (migration `20261002800000_commit_schedule.sql`): `commit_schedule(draft jsonb, source_type 'manual'|'upload', offline_friend_id)` validates a `ScheduleCommit` draft (unknown keys refused, so no location, D35), writes RRULE/UNTIL/EXDATE events plus a `sources` row with the period, and replaces the target's previous upload/manual source in the same transaction (gcal never touched). 20/day. Errors WF401 (invalid draft), WF402 (event never in the period). Jamaican holidays are pre-filled as removable exceptions. **Left for WF-027:** take a job id, move it to `committed`, delete the draft and file row in the same transaction, return the storage path for removal.

> Merged: `confirm_parse_job(job_id, draft)` runs `commit_schedule`, marks the job `committed` and deletes the draft and file row in the same transaction; the server removes the Storage object straight away and a trigger queues it in `storage_removals` for the sweep if that fails (D38). WF403 = job not ready (e.g. double submit).

**Acceptance criteria**
- [x] The `commit_schedule` database function writes recurring events as RRULE plus EXDATE, and creates a `sources` row with the date range
- [x] The user sets or confirms the date range. Exceptions such as breaks can be added.
- [x] Jamaican public holidays are pre-filled as exceptions (P1 part)
- [x] The job moves to `committed`
- [x] The **draft and the file's row are deleted in the same transaction** as the commit, and the Storage object is removed straight after. The expiry cron retries any removal that fails (D38).

#### WF-031 · Manual schedule entry
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-029
- **PRD:** FR-IMP-12

> Merged: "Type it in" opens the review editor on an empty 16-week draft (`/import/manual/review`, `/onboarding/review?job=manual`, plus buttons on My schedule and Settings → Calendars); confirm calls `commit_schedule`. My schedule reads the real saved schedule (offline-friend rows filtered). The failed-parse entry point is still mock until WF-027.

**Acceptance criteria**
- [x] Users can build a schedule from scratch with the WF-029 event editor, without uploading anything
- [x] Available from onboarding, from a failed parse, and from My schedule

#### WF-032 · Pending uploads list (view, delete)
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `in-review`
- **Depends on:** WF-026
- **PRD:** FR-IMP-16, NFR-COMP-2, D38

Confirmed files are deleted straight away, so this list only shows uploads that haven't been confirmed yet.

> Merged with WF-026/027: Pending uploads lists real files with their deletion date, live status, view, retry and delete (`delete_schedule_upload`).

**Acceptance criteria**
- [ ] `/uploads` lists unconfirmed files with the upload date and the date each will be deleted (7 days after upload)
- [ ] Users can view or delete any pending file, and deleting one also deletes its draft
- [ ] Tapping a pending file resumes its review

#### WF-033 · Re-upload and schedule replacement
- **Category:** `feature` · **Area:** `backend`, `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-030
- **PRD:** FR-IMP-17, J6

**Acceptance criteria**
- [ ] Users can upload a new schedule at any time
- [ ] The old recurring events end on a date the user picks, and history is kept
- [ ] The new file follows the same deletion rules (deleted on confirm, D38)

#### WF-034 · Re-parse a stored file
- **Category:** `feature` · **Area:** `backend` · **Priority:** P1 · **Milestone:** stretch · **Status:** `wontfix`
- **Depends on:** WF-027
- **PRD:** FR-IMP-18, D33

> **Won't fix (D38):** files are now deleted when the schedule is confirmed, so there's nothing left to re-parse. Retrying a *pending* file is covered by WF-027.

**Acceptance criteria**
- [ ] "Re-parse" on a stored file creates a new job that goes to review
- [ ] The file's `deleteAt` does **not** change

#### WF-035 · Parse rate limiting
- **Category:** `security` · **Area:** `backend` · **Priority:** P0 · **Milestone:** Gate · **Status:** `in-review`
- **Depends on:** WF-027
- **PRD:** FR-IMP-19, NFR-SEC-9, NFR-COST-1

> Merged with WF-027: 5 parse attempts a day (`parse` counter in `start_parse_job`), offline friends' parses included; an identical pending file (same `sha256`, same target) reuses its job; PT429 messages for `parse` and `schedule_upload`.

**Acceptance criteria**
- [x] Each user gets 5 parse attempts per day, using the `rateLimits` counter checked inside the parse-job function
- [x] Uploading a file identical to one that's still pending (same `sha256`) reuses that job and doesn't use up an attempt
- [x] A clear message appears when the limit is reached
- [x] Parses for offline friends' timetables count towards the same limit (WF-127)

#### WF-036 · Dated schedules (rosters)
- **Category:** `feature` · **Area:** `parser` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-023, WF-028
- **PRD:** FR-IMP-6, D28

Only start this once recurring extraction (WF-028) is working, and only if the eval set suggests it's feasible.

**Acceptance criteria**
- [ ] The parser recognises dated schedules and outputs events on specific dates
- [ ] The review screen supports a date-based view as well as the week grid
- [ ] ≥ 70% acceptance on the roster samples in the eval set

#### WF-037 · Retention jobs (files, events, pings)
- **Category:** `compliance` · **Area:** `backend` · **Priority:** P0 · **Milestone:** B · **Status:** `in-progress`
- **Depends on:** WF-026, WF-030
- **PRD:** FR-ADM-4, NFR-COMP-8, D32, D38

The ping part waits for WF-092 (it can ship without it and be extended later).

> From WF-063: also call `private.purge_expired_status_overrides()`.

> From NFR-SEC-9: also call `private.purge_expired_rate_limits()`.

> Files part merged with WF-027: expired never-confirmed files are deleted with their drafts by the sweep (every minute), and Storage removals are retried from `storage_removals`. Counts are returned by the sweep, not stored. **Left:** the event and ping purges.

**Acceptance criteria**
- [ ] A daily cron deletes **unconfirmed** files past `deleteAt` (7 days), along with their drafts
- [ ] A daily cron purges past events older than 90 days
- [ ] A daily cron purges pings older than 30 days (once WF-092 exists)
- [ ] Each run records how many items it deleted

#### WF-038 · Camera capture on upload
- **Category:** `feature` · **Area:** `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-026
- **PRD:** FR-IMP-2

**Acceptance criteria**
- [ ] "Take a photo" opens the camera on mobile (the file input's `capture` attribute)
- [ ] The photo goes through the normal upload flow

#### WF-039 · Run parser evals in CI
- **Category:** `test` · **Area:** `parser` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-006, WF-022
- **PRD:** NFR-OPS-3

**Acceptance criteria**
- [ ] Changes in `packages/parser` trigger an eval run
- [ ] The PR fails if accuracy drops below the stored baseline
- [ ] Eval samples aren't exposed in CI logs

---

### Phase 2: Social & visibility

#### WF-040 · Profiles and handles
- **Category:** `feature` · **Area:** `social` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-004
- **PRD:** FR-AUTH-2

> From WF-041: `users.handle` isn't client-writable yet (add the grant with the format rules). Showing other users' names and avatars needs a security-definer function that applies blocks.

> Backend done (merged): handle rules in `@whosfree/shared` (`Handle`, reserved words) and SQL; `set_handle` (10/day), `get_profile`, `find_user_by_handle` (exact match, 100/hour); blocks hidden both ways. Left: web wiring.

> Web merged: edit name, timezone and handle (`set_handle`, friendly WF101–103/PT429 messages); finding people by exact handle and by friend link `/add/<id>` (with QR). **Avatar replacement is blocked:** there's no avatars Storage bucket yet (needs a migration and upload UI).

> Merged (migration `20261003200200_avatars_bucket.sql`): Settings → Profile can change or remove the photo. The server checks magic bytes, re-encodes to a 256 px WebP with no EXIF/GPS (D35) and stores it in the public `avatars` bucket under an unguessable name; only block-aware functions hand out the URL. **Follow-ups:** other people's photos still show as initials (`PersonAvatar` has no image support); `users.avatar_url` is client-writable, so before showing others' photos restrict it to our Storage URLs (WF-120); account deletion must remove stored photos (WF-114).

**Acceptance criteria**
- [x] Users can edit their display name and avatar (the Google avatar can be replaced)
- [x] An optional, unique handle (`@kemar`), checked for allowed characters and reserved words

#### WF-041 · Visibility tiers and server-side redaction
- **Category:** `security` · **Area:** `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** WF-003, WF-021
- **PRD:** FR-VIS-3, FR-VIS-5, NFR-SEC-2, D1, D20, D27

**The core privacy guarantee.** Everything that shows another user's schedule goes through this. It's enforced in Postgres (D41).

`resolve_tier` needs to know who is connected, so this issue also creates the `friendships`, `blocks`, `groups` and `groupMembers` tables (schema and RLS only, read-only for clients), plus `sources` and `events`, which redaction works on. The flows that write connections belong to WF-042, WF-043, WF-045 and WF-047.

> Done: `private.resolve_tier`, `private.redacted_events` and the only client entry point, `public.events_for_viewer(owner_id, range_start, range_end)`. 129 backend tests, including a tier matrix, a property test against a TypeScript model, and a catalog snapshot of every grant and policy.

**Acceptance criteria**
- [x] `visibilityRules` table (friend or group target, tier 1–3), with RLS
- [x] A single `resolve_tier(viewer, owner)` SQL function: a tier set for the individual friend wins, otherwise the **most restrictive** shared group applies, and T1 is the minimum. No connection (or a block) means no access.
- [x] A single redaction path (`events_for_viewer`): T1 = status + times, T2 = + category, T3 = + title. There is no location field to leak (D35).
- [x] RLS stops anyone selecting another user's `events` rows directly
- [x] Tests prove a viewer never receives fields above their tier

#### WF-042 · Friend requests with tier choice
- **Category:** `feature` · **Area:** `social` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-040, WF-041
- **PRD:** FR-SOC-1, FR-VIS-1

> Backend done (merged): `send_friend_request[_by_handle](…, tier)`, `accept_friend_request(user, tier)`, decline, cancel, `list_friend_requests`, `list_friends`. Mutual requests auto-accept. Limits: 20/day, 3 per week to the same person. **Still to do:** friend requests by invite link (needs WF-045's invites table), QR code UI, notifications.

> Web merged: requests by handle, by friend link `/add/<id>` and by QR, plus accept/decline/cancel with a tier picker (T1 default). **Left:** requests through an *invite link* need a SQL change (drop `invites_group_required` and add friend-invite functions, which would also make friend links revocable), and notifications.

> Merged (migration `20261003200100_friend_invites.sql`): revocable friend invite links `/i/<code>` (create, replace, turn off; one live link per user), joined through `/join/<code>` with a tier picker; remembered through sign-up and picked up on the first visit to Now. Web Push on a new request and on acceptance. `/add/<id>` still works.

**Acceptance criteria**
- [x] Friend requests can be sent by handle, invite link or QR code, and are accepted or declined
- [x] Each side picks the tier the other will see before the connection is made, with T1 selected by default
- [x] Friend requests are rate-limited (NFR-SEC-9)

#### WF-043 · Groups: create, edit, admin role, 20-member cap
- **Category:** `feature` · **Area:** `social` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-040
- **PRD:** FR-SOC-2, FR-SOC-5, FR-SOC-7, FR-SOC-9, FR-SOC-10, FR-SOC-11, D17

> From WF-041: the tables exist. Still needed here: a member-list function that applies blocks, keeping `groups.adminId` and the admin `groupMembers` row in sync, locking the group row in `join_group` so the cap holds, and no `groupMembers` row before a join request is approved.

> Backend done (merged): `create_group` (10/day), `update_group`, `transfer_group_admin`, `delete_group`, `list_my_groups`, `get_group_members` (blocks hidden both ways). Cap = `groups.max_members`, enforced under a group row lock; a deferred trigger keeps `admin_id` and the admin row in sync. A lone admin must delete, not leave. Left: web wiring.

> Web merged: create (with emoji), edit, transfer admin, delete; leave refuses an admin until they transfer. Needs a live check.

**Acceptance criteria**
- [x] Users can create a group with a name and emoji, and the creator becomes the **admin**
- [x] The admin can transfer the admin role and delete the group. An admin must transfer the role before leaving.
- [x] Capped at **20 members**, with the cap stored as a config value (NFR-SCALE-4)
- [x] The admin gets **no extra visibility** into members' schedules (covered by a test)
- [x] Joining a group doesn't create a friendship

#### WF-044 · Group member permissions
- **Category:** `feature` · **Area:** `social` · **Priority:** P0 · **Milestone:** Gate · **Status:** `in-review`
- **Depends on:** WF-043
- **PRD:** FR-SOC-8, D26

> Backend done (merged): `set_group_member_permissions` (admin only), `remove_group_member` (admin or manageMembers; never the admin). Losing `invite` revokes that member's links. Left: web wiring.

> Web merged: per-member permission toggles in `/groups/[id]/settings` (optimistic, rolled back if refused), and remove member. Needs a live check.

**Acceptance criteria**
- [x] Permissions are `invite`, `manageMembers`, `editGroup` and `groupPing`
- [x] New members start with `invite` ✓, `groupPing` ✓, `manageMembers` ✗, `editGroup` ✗
- [x] The admin can grant and revoke each one per member in `/groups/[id]/settings`
- [x] Every related mutation checks permissions on the server

#### WF-045 · Invite links, invite page and join flow
- **Category:** `feature` · **Area:** `social`, `web` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-041, WF-043
- **PRD:** FR-SOC-3, FR-WEB-3, FR-VIS-1, §8.5 (joining a group)

> Backend done (merged): `invites` table (128-bit codes), `create_group_invite` / `regenerate_group_invite` (30/day), `revoke_group_invite`, `list_group_invites`, public `get_invite_summary` (status valid/full/expired/used_up/revoked; details only for live links), `join_group(code, tier)` (20/day, one transaction). Joins are never refused because of a block. Approval-mode groups are rejected for now. **Wiring notes:** the web mock's invite shape (ok/full/invalid, `maxMembers`) must be mapped to the real statuses; rate-limit `/i/[code]` per IP on the route. Left: remembering the invite through sign-up.

> Web merged: create/revoke/regenerate links (expiry 1/7/30 days, use limit), public `/i/[code]` via `get_invite_summary` (anon), an http-only `wf_invite` cookie (24 h) carries the code through sign-up and onboarding, signed-in visitors join at `/join/[code]`. **Open:** per-IP rate limit on `/i/[code]` (edge/WAF rule, `TODO(NFR-SEC-9)`).

**Acceptance criteria**
- [x] Invite links can be created, revoked and regenerated, with optional expiry and a maximum number of uses
- [x] The `/i/[code]` page works without signing in and shows only the inviter, the group name and emoji, and the member count
- [x] The invite is remembered through sign-up and onboarding
- [x] A tier picker appears before joining, with T1 selected by default
- [x] A full group shows "This group is full"
- [x] Joining is one transaction: validate the invite, check the cap, then create the member row and the visibility rule

#### WF-046 · WhatsApp share and link previews
- **Category:** `feature` · **Area:** `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-045
- **PRD:** FR-SOC-4, FR-WEB-7

**Acceptance criteria**
- [ ] A Share button uses the Web Share API, falling back to a `wa.me` link
- [ ] Open Graph tags make WhatsApp preview the link as "Join *{group}* on whosfree"

#### WF-047 · Block, remove friend, leave group
- **Category:** `feature` · **Area:** `social` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-042, WF-043
- **PRD:** FR-SOC-6

> From WF-041: blocks live in the directed `blocks` table (D43). Blocking should also end the friendship and delete the related visibility rules, without telling the blocked person.

> Friends half done (merged): `unfriend`, `block_user` (also ends the friendship and requests, silently), `unblock_user`, `list_blocked_users`. Group leave is with WF-043. Pings (WF-092/094) must call `private.is_blocked`.

> Leave half done (merged): `leave_group` (admin must transfer first) revokes visibility, the leaver's group rule and their invite links at once.

> Web merged: block (friend page, inbox), remove friend, leave group. **Open:** no blocked-list/unblock UI yet (`list_blocked_users`/`unblock_user` exist); blocking from the inbox works once pings are real (WF-092).

**Acceptance criteria**
- [x] A blocked user can't see, ping or invite the person who blocked them, and isn't told
- [x] Removing a friend or leaving a group revokes visibility straight away
- [x] Every query that returns another user's data respects blocking

#### WF-048 · "Who can see me" page and overlap hint
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-041, WF-042, WF-043
- **PRD:** FR-VIS-2, FR-VIS-8, FR-VIS-3a, D27

**Acceptance criteria**
- [ ] Lists every friend and group with the tier that actually applies to them
- [ ] The tier can be changed from this page
- [ ] Shows a hint when an overlapping group lowers someone's tier ("Alice sees Free/Busy because you're both in *Netball*"), with a "Set a tier for Alice" action

#### WF-049 · "How others see me" preview
- **Category:** `feature` · **Area:** `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-048, WF-061
- **PRD:** FR-VIS-7

**Acceptance criteria**
- [ ] Users pick a friend or group and see their own schedule exactly as that viewer would, using the same `redact` path as WF-041

#### WF-050 · Pause sharing
- **Category:** `feature` · **Area:** `backend`, `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-041
- **PRD:** FR-VIS-6, D22

**Acceptance criteria**
- [ ] A toggle sets `sharingPaused`, and everyone then sees "Sharing paused"
- [ ] Resuming restores the previous tiers

#### WF-127 · Offline friends: add someone not on whosfree and import their timetable
- **Category:** `feature` · **Area:** `social`, `backend`, `web` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-030, WF-031
- **PRD:** FR-SOC-14, FR-SOC-15, FR-SOC-16, FR-SOC-18, FR-SOC-19, NFR-COMP-9, R14, D44, J8

Makes the app useful before someone's friends join (R2): they can upload or type in a friend's timetable and see when that friend is free. The table, RLS and tests can be built before the import pipeline; the upload part reuses WF-026 to WF-031.

> Backend done (merged, migrations `20261002300000`/`20261002300100`): `offline_friends` (owner-only RLS, writes through functions), `create_offline_friend(nickname, emoji, permission_confirmed)` (20 per user under a lock, 20/day), `update_offline_friend`, `delete_offline_friend` (cascades the schedule), `list_offline_friends()` (with `has_schedule`). `sources`/`events.offline_friend_id` has a composite FK so it can only point at the row owner's offline friend. `private.redacted_events` skips these rows. **Any other read of a user's own `events`/`sources` (own status in the web app, `now_for_viewer`, WF-049) must filter `offline_friend_id is null`**, because RLS can't tell them apart. Left: `scheduleFiles`/parse jobs must carry the target offline friend (WF-026–031), the web UI, and FR-SOC-19 (UI only: offer `delete_offline_friend`).

> Web merged: add (nickname, emoji, permission tick), edit, delete (schedule goes straight away) from Friends, with the 20 cap. `/import?friend=<id>` and `/import/manual/review?friend=<id>` carry the target through upload → parse → review → confirm and manual entry; their parses count towards the limit. FR-SOC-19: after becoming friends, Friends offers to delete an offline copy (never merged).

**Acceptance criteria**
- [x] `offline_friends` table (nickname 1–40 characters, optional emoji, `permission_confirmed_at`), owner-only under RLS; `sources` and `events` gain `offline_friend_id`
- [x] Adding one requires ticking "I have their permission to add their schedule", and the time is recorded
- [x] Their schedule comes from the same upload → parse → review → confirm flow (file deleted on confirm, D38) or from manual entry. Their parses count towards the owner's parse limit (WF-035).
- [x] **Nobody but the owner** can read an offline friend or their events, through any table or function, including `events_for_viewer`, friend lists and group views. Tests prove it.
- [x] Offline friends' events never affect the owner's own status, free time or what others see of the owner
- [x] The owner can edit the nickname, re-upload and delete (deleting removes the schedule straight away). At most 20 per user, as a config value.
- [x] If the same person later becomes a real friend, the owner is offered to delete the offline copy. The two are never merged automatically. (FR-SOC-19, Should)

#### WF-128 · Show offline friends on Now, detail page and Find a time
- **Category:** `feature` · **Area:** `web`, `availability` · **Priority:** P0 · **Milestone:** A · **Status:** `in-progress`
- **Depends on:** WF-064, WF-127
- **PRD:** FR-SOC-17, NFR-UX-1, J8

The Find a time part waits for WF-098. The invite action uses friend invite links (WF-042).

> Merged: Now has a "Not on whosfree" section (engine over their schedule with 08:00–22:00 in the viewer's timezone); `/friends/offline/[id]` shows their status, day and week, edit, re-upload / type in, delete and **Invite to whosfree** (shares the viewer's friend link). No ping anywhere; status is icon plus words. **Left:** picking them in the slot finder (WF-098).

**Acceptance criteria**
- [x] The Now screen has a **Not on whosfree** section with each offline friend's status and "until X", computed by the availability engine from their schedule and the default available hours (08:00–22:00)
- [x] A detail page shows their day and week, with edit, re-upload, delete and **Invite to whosfree**
- [ ] They can be picked as participants in the slot finder once WF-098 exists, clearly marked as not on whosfree
- [x] They can't be pinged; **Invite to whosfree** shares a friend invite link instead
- [x] Status is never shown by colour alone (NFR-UX-1)

---

### Phase 3: Availability & Now

#### WF-060 · Availability engine core
- **Category:** `feature` · **Area:** `availability` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** WF-021
- **PRD:** §6.6, FR-AVL-1, FR-AVL-3, FR-AVL-4, FR-AVL-9, NFR-OPS-2, D5, D18, D22

`packages/availability` is pure TypeScript with **no I/O**.

> Done: 134 tests, 100% coverage (enforced ≥ 90%), property tests for the interval maths. API: `statusAt`, `timeline`, `busyIntervals`, `freeIntervals`, `expandEvent`, `eventTimesFromDraft` (for WF-030), `parseRRule`. Recurrence and timezones are handled in-house (PRD §8.4).

**Acceptance criteria**
- [x] Merges events from every source and combines overlapping busy blocks
- [x] Applies the precedence order: `paused` → manual override → `no_schedule` → busy events → available hours → `free`
- [x] `statusAt(now)` returns the status plus "until X"
- [x] Everything is computed in UTC, with timezone edge cases tested
- [x] **≥ 90% test coverage**, including property-based tests for the interval maths

#### WF-061 · Recurrence expansion and multi-user free intervals
- **Category:** `feature` · **Area:** `availability` · **Priority:** P0 · **Milestone:** A · **Status:** `done`
- **Depends on:** WF-060
- **PRD:** FR-AVL-5, FR-AVL-6

**Acceptance criteria**
- [x] Expands RRULE events within a time range, respecting the schedule's date range, week patterns and exceptions
- [x] `freeIntervals(users[], range)` for up to 20 users over 14 days runs in ≤ 1 s (NFR-PERF-5). Measured at about 25–40 ms.

#### WF-062 · Available hours (onboarding slider and settings)
- **Category:** `feature` · **Area:** `web`, `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-014, WF-060
- **PRD:** FR-AVL-2, D24

> Backend done (merged): `availability_prefs` (default 08:00–22:00, one window per day, no overnight windows), `set_day_hours(day, start, end)`. Left: onboarding slider and settings UI.

> Web merged: `saveAvailableHours` replaces `availability_prefs.weekly` in one update (days switched off are left out = away all day); `getAvailableHours` reads it under RLS. Left: "away" outside hours shows once WF-064 runs the engine.

> The Now screen runs the engine (WF-064), so "away" outside available hours now shows to viewers. Onboarding records the hours step (WF-068).

**Acceptance criteria**
- [x] Onboarding asks "When are you usually up and about?" with a slider pre-set to **08:00–22:00 every day**
- [x] In settings, hours can be edited separately for each day
- [x] Times outside these hours show as `away`

#### WF-063 · Manual status override
- **Category:** `feature` · **Area:** `web`, `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-060
- **PRD:** FR-AVL-3, J5

> Backend done (merged): `set_status(status, label, ends_at)` (closes the previous status; `ends_at` ≤ 7 days; label ≤ 40 chars) and `clear_status()`. Left: the status chip, and WF-064 exposing it to viewers.

> Web merged: the status chip in the shell calls `set_status`/`clear_status` (`lib/actions/status.ts`), with presets, "until a time" and an optional 40-character note. The viewer's own chip reads its active override (`lib/data/status.ts`). Left: other viewers see it once WF-064 is wired. `set_status` still has no rate limit (TODO in SQL).

> Merged (migration `20261003200000_set_status_rate_limit.sql`): `set_status` is limited to 60 changes an hour (`STATUS_CHANGES_PER_HOUR`); `clear_status` isn't limited.

**Acceptance criteria**
- [x] A status chip is reachable from anywhere in the app. Options: Free, Busy, Do not disturb, Away, Studying/Focused.
- [x] An override can have an end time ("until 4 PM") or last "until I change it"
- [x] It overrides calendar-based status everywhere

#### WF-064 · Now screen (real-time, redacted)
- **Category:** `feature` · **Area:** `web`, `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-041, WF-042, WF-043, WF-061
- **PRD:** FR-VIEW-1, FR-VIEW-2, FR-VIEW-3, §8.5 (Now screen), NFR-PERF-1, NFR-PERF-3

> From WF-041: `events_for_viewer` returns nothing when the owner has paused sharing, so the Now query needs its own `paused` flag to show "Sharing paused".

> From WF-062/063: the Now function must read `availability_prefs` and `status_overrides` inside its definer function (clients can't read other users' rows). Suggest showing a status label only at T3, like event titles.

> Backend merged (migrations `20261002400000_now_for_viewer.sql`, `20261002400100_now_realtime_signals.sql`): `now_for_viewer(range_start, range_end)` returns each connection with tier, `paused`, `has_schedule`, shared `group_ids`, timezone, hours, overrides and redacted sources/events, in the engine's input shape (types `NowConnection` etc. in `@whosfree/backend`). Triggers send an empty `now_changed` Broadcast on private channel `user:<users.id>` (`userChannel()` in `@whosfree/shared`), once per transaction. Offline friends are excluded. **Left (web):** call it, run `statusAt` per connection (catch errors per connection), sections, group filter, subscribe to the channel (debounced re-fetch), client timer, non-colour status. Then remove the mock layer.

> Web merged: `getNowForViewer` calls `now_for_viewer` and runs `statusAt` per connection on the server (one bad schedule shows that person as "Status unavailable", not a crash); the viewer's own status uses the same engine with offline-friend rows filtered. The client subscribes to `user:<id>` (`lib/supabase/browser.ts`, publishable key + Clerk token) and does a debounced `router.refresh()` on `now_changed`; a local timer moves people between sections at each "until X". Friends, friend detail and group pages show real statuses (as of page load). **Left:** verify the ≤ 5 s Realtime path live (needs the two `2026100240…` migrations applied and Realtime authorization enabled). The mock layer remains only for group week/slots (WF-066/098), schedule (WF-065), inbox (WF-092), imports (WF-027–032) and the visibility overview (WF-048).

- [x] The `now_for_viewer` database function returns connections already redacted by `resolve_tier` and the redaction path (WF-041)
- [x] Sections: Free now, Free soon (within 60 minutes), Busy/Away, Not sharing yet. Each status shows "until X".
- [x] A group filter
- [ ] Status changes reach viewers in ≤ 5 s (Realtime Broadcast signal from a database trigger, then a re-fetch)
- [x] A timer on the client re-evaluates "until X" boundaries without polling the server
- [x] Status is never shown by colour alone (NFR-UX-1)

#### WF-065 · Friend detail and My schedule views
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-064
- **PRD:** FR-VIEW-4, FR-VIEW-5

**Acceptance criteria**
- [ ] A friend's detail page shows their timeline for today and tomorrow at the viewer's tier
- [ ] My schedule has day and week views, with a badge showing where each event came from (upload, manual or Google)

#### WF-066 · Group timeline view
- **Category:** `feature` · **Area:** `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-064
- **PRD:** FR-VIEW-6

**Acceptance criteria**
- [ ] Today's timeline for every member of the group, with the times everyone is free highlighted

#### WF-067 · Stale-data warning
- **Category:** `feature` · **Area:** `web`, `backend` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-064
- **PRD:** FR-VIEW-8, D25

The Google sync-failure trigger only starts working once WF-082 exists. The end-date trigger works as soon as schedules can be uploaded.

**Acceptance criteria**
- [ ] Healthy data shows no timestamp
- [ ] ⚠️ "Schedule may be out of date" appears when any of these is true: a source has failed, a source hasn't synced in over 24 h, or the schedule's end date has passed
- [ ] The same flag appears in the slot finder (WF-098)

#### WF-068 · End-to-end onboarding flow
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-005, WF-030, WF-045, WF-062
- **PRD:** J1, FR-WEB-5

The "Connect Google Calendar" step becomes active once WF-080 is done, and the install and push steps once WF-111 and WF-091 are done. Until then they're hidden.

> Merged (migration `20261003400000_onboarding_progress.sql`): `users.onboarding_steps`/`onboarded_at` written by `record_onboarding_step`; /onboarding resumes at the first unfinished step (schedule counts as done once one exists; the tier picker only with a working remembered invite) and sends finished users to Now. Existing users who accepted the terms are backfilled as onboarded. Sign-in and the manifest `start_url` now open /onboarding. **Left:** a real run with Clerk and Supabase, with and without an invite.

**Acceptance criteria**
- [x] Steps run in order: invite → sign up with the age check → available hours → upload or skip → review → (Google Calendar) → group tier picker → (install and push) → Now
- [x] Every step after sign-up can be skipped and picked up later
- [x] Works from an invite link and without one

#### WF-069 · Empty states and "nudge to add schedule"
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-064
- **PRD:** FR-VIEW-7, D22

The nudge is sent as a notification once WF-091 exists. Before that it shares a link.

**Acceptance criteria**
- [ ] Friendly empty states point people to invites
- [ ] People with `no_schedule` show "Hasn't added a schedule yet" and a "Nudge" action

#### WF-070 · Short-gap rule
- **Category:** `feature` · **Area:** `availability` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-060
- **PRD:** FR-AVL-8

**Acceptance criteria**
- [ ] Gaps shorter than `minGapMinutes` (default 15) count as busy
- [ ] The value can be changed in settings

---

### Phase 4: Google Calendar

#### WF-080 · Google Calendar OAuth (own flow, encrypted tokens)
- **Category:** `feature` · **Area:** `gcal` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-003, WF-004, WF-012
- **PRD:** FR-GCAL-1, NFR-SEC-3, §8.5 (Google Calendar sync), D8, D30

> From WF-041: clients can read their own `sources` rows, so the encrypted refresh token must go in a separate table clients can't select (NFR-SEC-3).

**Acceptance criteria**
- [ ] A "Connect Google Calendar" screen explains what we read before the user continues
- [ ] Our own OAuth flow with the `calendar.readonly` scope and a `state` parameter tied to the Clerk session. The callback route lives in `apps/web`.
- [ ] The Next.js server exchanges the code for tokens. The refresh token is encrypted with AES-256-GCM, stored in `sources`, and never sent to the client.
- [ ] Token refresh is handled

#### WF-081 · Calendar selection and initial sync
- **Category:** `feature` · **Area:** `gcal` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-060, WF-080
- **PRD:** FR-GCAL-2, FR-GCAL-3, FR-GCAL-6, FR-GCAL-11, FR-GCAL-12, D36

**Acceptance criteria**
- [ ] The user picks which calendars to include, with the primary calendar selected by default
- [ ] The initial sync covers 7 days back to 60 days ahead, with recurring events expanded (`singleEvents=true`), and events are updated in place rather than duplicated
- [ ] Events marked free or transparent, declined events and all-day events are ignored by default (all-day events can be counted if the user opts in)
- [ ] Google data is never sent to OpenRouter or any AI model
- [ ] Only start/end, busy, the private flag and the event ID are stored, with category `event`. **Descriptions, attendees, locations, conference links and attachments are dropped during sync and never written** (D36).
- [ ] Titles are handled by WF-125

#### WF-082 · Incremental sync, watch channels, polling fallback
- **Category:** `feature` · **Area:** `gcal` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-081
- **PRD:** FR-GCAL-4, FR-GCAL-5, NFR-REL-3

**Acceptance criteria**
- [ ] Incremental sync uses a `syncToken`. A `410 Gone` response triggers a full re-sync.
- [ ] `events.watch` channels point to a webhook route on the Next.js server, and a Supabase Cron job renews them before they expire
- [ ] Polling every 15 minutes as a fallback
- [ ] `sources.status` and `lastSyncedAt` are kept up to date (these feed WF-067)

#### WF-083 · Private calendars and events
- **Category:** `feature` · **Area:** `gcal` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-041, WF-081
- **PRD:** FR-GCAL-8, FR-VIS-4

**Acceptance criteria**
- [ ] A calendar or a single event can be marked "always private", and it then shows as "Busy" at every tier
- [ ] Enforced in `redact` (WF-041)

#### WF-084 · Disconnect Google Calendar and delete data
- **Category:** `feature` · **Area:** `gcal` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-080
- **PRD:** FR-GCAL-9

**Acceptance criteria**
- [ ] Disconnecting revokes the token with Google
- [ ] Every event from the Google source is deleted within 24 h, and watch channels are stopped

#### WF-085 · Sync health UI
- **Category:** `feature` · **Area:** `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-082
- **PRD:** FR-GCAL-10

**Acceptance criteria**
- [ ] The owner sees "Last synced 2 min ago" or "Reconnect needed"
- [ ] There's a one-tap reconnect

#### WF-086 · Submit Google OAuth verification
- **Category:** `compliance` · **Area:** `gcal` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-010, WF-012, WF-080
- **PRD:** NFR-COMP-5, NFR-COMP-6, D8, R3

This can take weeks. Up to 100 test users don't need it, so the closed beta isn't blocked.

**Acceptance criteria**
- [ ] Final name and domain are in place (WF-011)
- [ ] Demo video of how the scope is used, and a justification for sharing event titles with friends the user chooses
- [ ] Submitted. Keep track of Google's questions and answer them.
- [ ] Approved, with the 100-user cap lifted

#### WF-087 · Handle Google accounts managed by an organisation
- **Category:** `feature` · **Area:** `gcal` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-080
- **PRD:** R11

**Acceptance criteria**
- [ ] The OAuth error that means "an admin has blocked this app" is detected
- [ ] A clear message suggests connecting a personal account or uploading a schedule instead

#### WF-125 · Google event titles only while a T3 grant exists
- **Category:** `security` · **Area:** `gcal` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-041, WF-081
- **PRD:** FR-GCAL-13, NFR-COMP-8, D36

Google event titles often contain sensitive details ("Therapy", "Clinic", "Court"). Store them only while someone is actually allowed to see them.

**Acceptance criteria**
- [ ] While the owner has **no** T3 grant (friend or group), Google titles are never written to the database
- [ ] Granting the first T3 triggers a re-sync that fills in titles
- [ ] Removing the last T3 deletes all stored Google titles within 24 h
- [ ] Tests cover grant → titles appear, and revoke → titles deleted

---

### Phase 5: Pings & slot finder

#### WF-090 · PWA manifest and service worker (Serwist)
- **Category:** `infra` · **Area:** `pwa` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-002
- **PRD:** FR-PWA-1

Could start at any point after WF-002. It's placed here because push notifications need it.

> Merged: `app/manifest.ts`, icons and iOS launch images, and a Serwist worker (`@serwist/turbopack`) served at `/serwist/sw.js` with scope `/`. It precaches only `/_next/static`, `public/icons` and a static `/offline` page. Navigations are network-only, and HTML, RSC, server actions and API responses are never cached. Headless Chrome reports no installability errors. **Left:** install on a real Android and iOS 16.4+ device from an HTTPS deploy (needs WF-002's Vercel connection). The auth proxy must leave `/serwist/*`, `/manifest.webmanifest`, `/icons/*`, `/splash/*` and `/offline` public. `skipWaiting` stays on until WF-112.

**Acceptance criteria**
- [x] A manifest with icons, a splash screen and `display: standalone`
- [x] A Serwist service worker precaches the app shell
- [ ] The app can be installed on Android Chrome and iOS Safari (verified in headless Chrome only; needs a device test on a deploy)

#### WF-091 · Web Push infrastructure
- **Category:** `infra` · **Area:** `pwa`, `backend` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-004, WF-090
- **PRD:** FR-PWA-4, FR-PING-3, NFR-COMPAT-2

> Merged (migration `20261002500000_push_subscriptions.sql`): `push_subscriptions` (owner-only RLS, writes via `save_push_subscription`/`delete_push_subscription`, 10 devices per user, 20 new/day), `sendPushToUser(userId, payload)` in `apps/web/src/lib/push/send.ts` (web-push, removes 404/410 devices, never logs payloads), SW `push`/`notificationclick` handlers, the `PushPermission` card (explanation first; handles iOS-not-installed, blocked, unsupported) in Settings and onboarding, and a "send a test" button. Inbox data itself is WF-092. **For WF-092:** have `send_ping` authorise as the sender, then `after(() => sendPushToUser(recipientId, {v:1, kind:'ping', title, body, url:'/inbox', tag:'ping:<id>'}, {urgency:'high'}))`. **Left (owner):** VAPID keys (`npx web-push generate-vapid-keys` → root `.env` and Vercel), `SUPABASE_SECRET_KEY` in Vercel, apply the migration, device test on Android and installed iOS 16.4+.

- [x] VAPID keys, and a `pushSubscriptions` table with one row per device
- [x] Permission is asked for **only after an explanation screen**, never on first load
- [x] The Next.js server sends pushes with `web-push`. Dead subscriptions are removed.
- [x] An in-app inbox as a fallback for anyone without push

#### WF-092 · Send pings and inbox
- **Category:** `feature` · **Area:** `ping` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-064, WF-091
- **PRD:** FR-PING-1, FR-PING-2, FR-PING-3, J3, D14, D31

> Merged (migration `20261003000000_pings.sql`): `send_ping(recipient, template, message, confirmed)` (connections only, blocks hidden, dnd/paused refused WF301, not-free needs confirmation WF302, 30/day), `list_inbox`, `mark_pings_read`, `unread_ping_count`, `inbox_changed` signal; web sends push via `after(sendPushToUser)` and the inbox updates live. **Open:** device test with live VAPID keys; the server's ping status is an approximation in SQL. Hooks: `TODO(WF-094)` per-recipient limit/mute/quiet hours, `TODO(WF-095)` report, `TODO(WF-096)` group ping.

**Acceptance criteria**
- [x] Ping a friend or fellow group member using a template, free text of **140 characters or fewer**, or both
- [x] Pinging someone who is `busy` or `away` asks for confirmation first. Pinging someone who is `dnd` or `paused` is blocked. All of these are enforced on the server.
- [x] Text is shown **as plain text only**, and URLs aren't clickable
- [x] Pings arrive as push notifications and appear in `/inbox`
- [x] Ping text never appears in logs or analytics

#### WF-093 · Ping replies
- **Category:** `feature` · **Area:** `ping` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-092
- **PRD:** FR-PING-4

> Merged (migration `20261003000100_ping_replies.sql`): `reply_to_ping(ping_id, reply, message)`, notification reply buttons where supported (Chrome) and in-app buttons otherwise, sender notified by push and `inbox_changed`. **Open:** the 10 s end-to-end check on an Android device; late replies after expiry are WF-097.

**Acceptance criteria**
- [x] One-tap replies ("I'm down", "In 10", "Can't right now") from notification buttons where the platform supports them, and from the app otherwise
- [x] A short free-text reply is possible
- [x] The sender is notified of the reply
- [ ] A ping and its reply take under 10 s end to end on Android (needs a device test)

#### WF-094 · Ping rate limits, mute, quiet hours
- **Category:** `security` · **Area:** `ping` · **Priority:** P0 · **Milestone:** Gate · **Status:** `todo`
- **Depends on:** WF-092
- **PRD:** FR-PING-6, FR-PING-7, NFR-SEC-9

**Acceptance criteria**
- [ ] A sender can ping the same person at most 3 times an hour, and at most 30 pings a day in total
- [ ] Users can mute a person or a group, optionally with an end time
- [ ] During quiet hours pings are silent (they still go to the inbox)

#### WF-095 · Report and block, plus moderation queue
- **Category:** `security` · **Area:** `ping`, `backend` · **Priority:** P0 · **Milestone:** Gate · **Status:** `todo`
- **Depends on:** WF-047, WF-092
- **PRD:** FR-PING-8, FR-SET-4, D31

**Acceptance criteria**
- [ ] One-tap "Report" and "Block" on any ping
- [ ] Users and groups can also be reported
- [ ] A `reports` table and a simple review queue (the full admin view comes in WF-118)

#### WF-096 · Group ping
- **Category:** `feature` · **Area:** `ping` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-044, WF-092
- **PRD:** FR-PING-5

**Acceptance criteria**
- [ ] Pings every group member who is currently free
- [ ] Needs the `groupPing` permission, checked on the server
- [ ] Counts towards the sender's rate limits

#### WF-097 · Ping expiry
- **Category:** `feature` · **Area:** `ping` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-092
- **PRD:** FR-PING-9

**Acceptance criteria**
- [ ] Pings older than 2 h show as expired and can't be replied to

#### WF-098 · Group slot finder
- **Category:** `feature` · **Area:** `availability`, `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-043, WF-061
- **PRD:** FR-SLOT-1 to FR-SLOT-4, J4

**Acceptance criteria**
- [ ] Inputs: a group or chosen people (up to 20), a date range (up to 14 days), a minimum duration, and an optional time-of-day window
- [ ] Results: slots where everyone is free come first (soonest, then longest), followed by "all but N" slots that name who can't make it
- [ ] Reveals only *when* people are free, never why they're busy
- [ ] Anyone with `no_schedule` or `paused` is flagged and left out
- [ ] Results in ≤ 1 s for 20 people over 14 days
- [ ] Offline friends (WF-127) can be picked as participants, clearly marked

#### WF-099 · Share a slot
- **Category:** `feature` · **Area:** `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-096, WF-098
- **PRD:** FR-SLOT-5

**Acceptance criteria**
- [ ] Share a slot as a group ping ("How about Thu 2–3 PM?") if the user has the `groupPing` permission
- [ ] Copy the slot as text for WhatsApp

---

### Phase 6: PWA polish & beta

#### WF-110 · Offline cache of last-known Now
- **Category:** `feature` · **Area:** `pwa` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-064, WF-090
- **PRD:** FR-PWA-2

**Acceptance criteria**
- [ ] The app opens offline and shows the last-known Now data with a "Last updated X min ago" banner
- [ ] Cached data only ever contains what was already redacted for this viewer

#### WF-111 · Install prompt and iOS guide
- **Category:** `feature` · **Area:** `pwa` · **Priority:** P0 · **Milestone:** A · **Status:** `in-review`
- **Depends on:** WF-090
- **PRD:** FR-PWA-3, R5

> Merged: `beforeinstallprompt` captured early with our own prompt; an iOS step-by-step guide (with variants for other iOS browsers and in-app browsers) that explains push needs the installed app; a closable banner on phones; hidden when installed; once dismissed it stays hidden until Settings → Install app or the help page. **Left:** device tests on Android and iOS 16.4+.

**Acceptance criteria**
- [x] Android: a custom prompt built on `beforeinstallprompt`
- [x] iOS: a step-by-step "Add to Home Screen" guide explaining that push notifications need the app installed
- [x] Not shown again if the user dismisses it, until the user asks for it

#### WF-112 · App update flow
- **Category:** `feature` · **Area:** `pwa` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-090
- **PRD:** FR-PWA-6

**Acceptance criteria**
- [ ] A "New version available, tap to refresh" message when a new service worker is waiting

#### WF-113 · Export my data
- **Category:** `compliance` · **Area:** `backend` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-030, WF-042, WF-092
- **PRD:** FR-SET-1, NFR-COMP-2, D39

Until this is built, export requests are handled manually (WF-126).

**Acceptance criteria**
- [ ] Produces a JSON bundle of the user's profile, preferences, events, connections, groups, pings, and consent records, plus any pending (unconfirmed) files
- [ ] Only the user's own data is included, never other users' private details
- [ ] Includes the user's offline friends and their schedules

#### WF-114 · Delete my account
- **Category:** `compliance` · **Area:** `backend` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-030, WF-043, WF-080
- **PRD:** FR-SET-2, FR-SOC-7, NFR-COMP-8, D39

Until this is built, deletion requests are handled manually (WF-126).

> From WF-041: `groups.adminId` is `on delete restrict`, so the admin role must be handed over before the user row is deleted.

**Acceptance criteria**
- [ ] Removes the user from every group straight away, deletes any pending files straight away, and revokes Google tokens
- [ ] If they're a group admin, the role passes to the longest-standing member
- [ ] All other data is permanently deleted within 30 days
- [ ] The Clerk user is deleted
- [ ] Deletes the user's offline friends and their schedules straight away

#### WF-115 · Notification settings
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-091
- **PRD:** FR-SET-3

**Acceptance criteria**
- [ ] Separate on/off switches for pings, friend requests, group invites and schedule-expiry reminders

#### WF-116 · Accessibility audit (WCAG 2.1 AA)
- **Category:** `test` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-064, WF-092, WF-098
- **PRD:** NFR-UX-1, NFR-UX-2

**Acceptance criteria**
- [ ] Contrast, focus and screen-reader labels checked on every core screen
- [ ] Status never relies on colour alone
- [ ] Any problems found are logged as `bug` issues

#### WF-117 · Performance budget check
- **Category:** `test` · **Area:** `web` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-009, WF-064
- **PRD:** NFR-PERF-1, NFR-PERF-2

**Acceptance criteria**
- [ ] LCP ≤ 2.5 s on Fast 3G for the landing page and the Now screen
- [ ] The first route loads ≤ 200 KB of gzipped JS
- [ ] Budgets are checked in CI (Lighthouse CI or bundle-size check)

#### WF-118 · Admin view and feature flags
- **Category:** `feature` · **Area:** `ops` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-004
- **PRD:** FR-ADM-1, FR-ADM-2, FR-ADM-3

**Acceptance criteria**
- [ ] `/admin` restricted to an internal role: users, groups, parse jobs (status and failure reason), reports
- [ ] Feature flags to roll out the slot finder, Google Calendar and so on
- [ ] Parser eval results are visible (from WF-022)

#### WF-119 · Jamaica DPA: legal review and OIC registration
- **Category:** `compliance` · **Area:** `legal` · **Priority:** P0 · **Milestone:** Gate · **Status:** `todo`
- **Depends on:** — (the drafts in [docs/legal/](docs/legal/) are enough to begin)
- **PRD:** NFR-COMP-1 to NFR-COMP-4, D9, R9

**Acceptance criteria**
- [ ] A Jamaican data-protection lawyer has reviewed the privacy policy, terms and retention periods
- [ ] Registered as a data controller with the Office of the Information Commissioner, and a Data Protection Officer appointed if required
- [ ] The legal basis for sending data abroad is documented
- [ ] A breach-notification runbook is written, with the deadline confirmed
- [ ] The review covers the lawful basis for holding schedules of people who aren't users (offline friends, NFR-COMP-9)

#### WF-120 · Security review (authorisation and redaction tests)
- **Category:** `security` · **Area:** `backend` · **Priority:** P0 · **Milestone:** Gate · **Status:** `todo`
- **Depends on:** WF-041, WF-064, WF-092
- **PRD:** NFR-SEC-1 to NFR-SEC-11

**Acceptance criteria**
- [ ] Every table has RLS enabled, and every database function and server route has an authorisation test
- [ ] Redaction tests confirm no viewer receives data above their tier, a blocked user's data, or location
- [ ] Worker HMAC and replay protection tested
- [ ] Logs audited to confirm they hold no titles, ping text or tokens
- [ ] Any problems found are logged as `bug` or `security` issues
- [ ] Tests confirm no one but the owner can read an offline friend or their events (FR-SOC-15)

#### WF-121 · Closed beta launch
- **Category:** `chore` · **Area:** `ops` · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** WF-068, WF-092, WF-098, WF-110, WF-111, WF-119, WF-120
- **PRD:** §13 Phase 6, §10

Google Calendar can be part of the beta with up to 100 test users even before WF-086 is approved.

**Acceptance criteria**
- [ ] Launched to one friend circle, then to one seed community (30–100 users)
- [ ] The metrics in PRD §10 are being tracked in PostHog
- [ ] A way to give feedback is set up (in-app link or a WhatsApp group)
- [ ] The [ASSUMPTION] values in the PRD are updated with beta data

#### WF-122 · User research interviews
- **Category:** `research` · **Area:** — · **Priority:** P0 · **Milestone:** B · **Status:** `todo`
- **Depends on:** —
- **PRD:** §13 next steps, A1, A2, A7

Can start now, before any code.

**Acceptance criteria**
- [ ] 5–10 interviews with students, shift workers and organisers
- [ ] Covers how they coordinate today, how much schedule detail they'd share, their devices (Android vs iOS) and data costs
- [ ] Findings summarised, with any changes needed in the PRD

#### WF-123 · Help / FAQ pages
- **Category:** `docs` · **Area:** `web` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-111
- **PRD:** FR-WEB-6

**Acceptance criteria**
- [ ] `/help` covers installing (including the iOS guide), privacy tiers, how parsing works, and deleting your data

#### WF-124 · Schedule-expiry reminder
- **Category:** `feature` · **Area:** `backend` · **Priority:** P1 · **Milestone:** stretch · **Status:** `todo`
- **Depends on:** WF-030, WF-091
- **PRD:** J6

**Acceptance criteria**
- [ ] 7 days before a schedule's end date, the user gets "Your schedule ends {date}. Upload the new one?"
- [ ] Tapping it opens the upload flow


#### WF-126 · Manual export/deletion request process
- **Category:** `compliance` · **Area:** `legal` · **Priority:** P0 · **Milestone:** Gate · **Status:** `todo`
- **Depends on:** WF-010
- **PRD:** FR-SET-1, FR-SET-2, NFR-COMP-2, D39

A temporary way to meet data-subject rights at public launch, before the self-serve export (WF-113) and deletion (WF-114) are built.

**Acceptance criteria**
- [ ] A privacy contact inbox is set up, and the privacy policy names it
- [ ] Identity check: the request must come from the account's email address
- [ ] A written runbook plus internal SQL functions to (a) export all of a user's data as JSON and (b) delete their account (the same steps WF-114 will automate)
- [ ] Every request is logged with the date received and the date completed, and completed within **30 days**
- [ ] Retire the manual process once WF-113 and WF-114 are `done`

---

## 6. Bugs

Log bugs here using the [bug template](#bug-template). Each bug takes the next free `WF-###` ID, and you also add a row to the [index](#4-index) with category `bug`.

**Severity**
| Severity | Meaning | Examples |
|---|---|---|
| **S1: Critical** | Privacy or security breach, data loss, or the app unusable for everyone | A viewer sees event titles above their tier. Account deletion doesn't delete data. |
| **S2: Major** | A core flow is broken for many users, with no workaround | Parsing always fails for PDFs. Pings aren't delivered. |
| **S3: Minor** | Broken, but there's a workaround or few people are affected | "Until X" is wrong at midnight. The iOS install guide shows on Android. |
| **S4: Trivial** | Cosmetic | A typo, misaligned icon, or dark-mode contrast issue |

> Any bug that could leak data above a viewer's tier, or leak location, is **automatically S1** and gets fixed before anything else.

*No bugs logged yet.*

---

## 7. Templates

### Issue template
```markdown
#### WF-### · <Short, imperative title>
- **Category:** `feature` · **Area:** `web` · **Priority:** P0 · **Milestone:** A / B / stretch · **Status:** `todo`
- **Depends on:** WF-###, WF-### (or —)
- **PRD:** FR-…, NFR-…, D…

<One or two sentences: what and why.>

**Acceptance criteria**
- [ ] …
- [ ] …
```

### Bug template
```markdown
#### WF-### · <What is broken>
- **Category:** `bug` · **Area:** `web` · **Severity:** S1–S4 · **Status:** `todo`
- **Found in:** <environment: dev / preview URL / prod> · <device + browser> · <date>
- **Related to:** WF-### (the feature where it appears), PRD FR-…
- **Depends on:** — (or the issue that must be fixed first)

**Steps to reproduce**
1. …
2. …

**Expected:** <what the PRD or acceptance criteria say should happen>
**Actual:** <what happens>

**Notes / screenshots / logs:** <never paste real users' schedule data, ping text or tokens>

**Fix criteria**
- [ ] Root cause identified
- [ ] Fix merged with a test that fails without it
```
