# whosfree — Product Requirements Document

| Field | Value |
|---|---|
| Product | whosfree (working name, see D23) |
| Document version | 0.13 |
| Status | Draft. All open questions resolved, ready for Phase 0 (see [§14](#14-open-questions)) |
| Last updated | 2026-10-01 |
| Owner | Dimetri Lee |
| Launch market | Jamaica, adults 18+ with busy schedules |

### Revision history
| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-09-30 | First draft built from the MVP idea and the first round of decisions (D1–D10). |
| 0.2 | 2026-09-30 | Added answers to the open questions (D11–D23). The audience is now **anyone with a schedule**, not just university students. Raw files are kept for up to 6 months. Minimum age is 18. Pings can include free text. AI calls go through **OpenRouter**. Groups have an **admin, per-member permissions and a 20-member cap**. Viewers see "free until X". Auth uses **Clerk**. Users **choose a visibility tier when they join a group**. Added public web pages (landing, auth, invite, legal). The "unknown" status is replaced by "Hasn't added a schedule yet" and "Sharing paused". Added dated schedules (rosters). New open questions OQ16–OQ23. |
| 0.3 | 2026-09-30 | Resolved every remaining open question by accepting the recommendations (D24–D33). Default available hours come from an "up and about" slider set to 08:00–22:00. A stale-data warning appears only when data is stale. Default group-member permissions are set. When a viewer shares several groups with you, the most restrictive tier applies and a hint explains why. Dated schedules are a Should. The age check uses a self-declared date of birth. Google Calendar uses our own OAuth flow. Free-text pings are capped at 140 characters and shown as plain text. Retention: past events 90 days, pings 30 days. The 6-month file clock never resets. |
| 0.4 | 2026-09-30 | The MVP is now delivered in two milestones (D34): **A, the core loop, including friends**, then **B, MVP complete**. Added §13.1, which maps the milestones to [ISSUES.md](ISSUES.md). |
| 0.5 | 2026-09-30 | **Data minimisation** (D35–D38): event locations are no longer stored. Google Calendar stores only what's needed, and titles only when someone has the Details tier. No IP addresses go to analytics or error tracking. **Raw files are deleted when the user confirms the schedule** (replaces D12 and D33). Added a **public-ready gate** (D39), and removed the incorrect "100 test users" note from Milestone A. Drafted the [privacy policy](docs/legal/privacy-policy.md) and [terms](docs/legal/terms.md). |
| 0.6 | 2026-09-30 | **Backend moves from Convex to Supabase** (D40): Postgres with row-level security, Supabase Storage, Realtime and Cron. Clerk stays for sign-in, connected through Supabase's third-party auth. **Authorisation and tier redaction are enforced in Postgres**, and TypeScript server logic runs on the Next.js server (D41). Updated the architecture (§8), data model (§9), NFRs and risks to match. |
| 0.7 | 2026-09-30 | Recorded decisions from building the availability engine (D42): recurrence and timezones are handled in-house instead of with `rrule` and `date-fns-tz`, `exdates` are occurrence start instants, and week numbers count from the Monday week containing the schedule's start date (FR-IMP-5). |
| 0.8 | 2026-09-30 | Data model matches the first migrations (D43): blocks get their own directed `blocks` table instead of a `blocked` friendship status; `events` use `startsAt`/`endsAt`; group permissions are four boolean columns; a source's period is three columns. |
| 0.13 | 2026-10-01 | Every account gets a **handle generated from its name** at sign-up, which can be changed but not removed (D47, FR-AUTH-2). |
| 0.12 | 2026-09-30 | **No Railway worker** (D46, after the WF-024 spike): PDF and HEIC conversion and the OpenRouter call run on the Next.js server, with uploads going straight to Supabase Storage and parse jobs queued in Postgres with a cron sweep. Updated §8, the parse flow and the NFRs that mentioned the worker. |
| 0.11 | 2026-09-30 | Phone navigation is a **hamburger menu** in the header, not the design's bottom bar (FR-WEB-9). |
| 0.10 | 2026-09-30 | Sign-in accepts **email and password** as well as Google (D45, FR-AUTH-1). |
| 0.9 | 2026-09-30 | Added **offline friends** (D44, FR-SOC-14 to FR-SOC-19, J8): a user can add someone who isn't on whosfree and upload or type in that person's timetable, so the app is useful before their friends join. Private to the uploader, a nickname only, with a permission confirmation. Part of Milestone A. |

> **How to read this document**
> - Requirements have IDs (`FR-<AREA>-<n>`, `NFR-<AREA>-<n>`) so issues, PRs and tests can refer to them.
> - Priorities use **MoSCoW**: **M** = Must (MVP), **S** = Should (MVP if time allows), **C** = Could (after the MVP), **W** = Won't (for now).
> - **[ASSUMPTION]** marks something we believe but haven't confirmed. Each one needs confirming or correcting.
> - Decisions are recorded in the [Decision Log](#15-decision-log) (D1, D2, …) and requirements refer to them.

---

## Table of contents

1. [Vision & problem](#1-vision--problem)
2. [Goals & non-goals](#2-goals--non-goals)
3. [Users & personas](#3-users--personas)
4. [Assumptions & constraints](#4-assumptions--constraints)
5. [User journeys (MVP)](#5-user-journeys-mvp)
6. [Functional requirements](#6-functional-requirements)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Architecture](#8-architecture)
9. [Data model (draft)](#9-data-model-draft)
10. [Success metrics](#10-success-metrics)
11. [Risks & mitigations](#11-risks--mitigations)
12. [Out of scope & future ideas](#12-out-of-scope--future-ideas)
13. [Roadmap & next steps](#13-roadmap--next-steps)
14. [Open questions](#14-open-questions)
15. [Decision log](#15-decision-log)
16. [Glossary](#16-glossary)

---

## 1. Vision & problem

### Vision
Anyone in your circle can see at a glance **who's free right now** and when everyone will be free later, without having to ask.

### Problem
Busy people's schedules are spread across several places: class timetables, work rosters and shift schedules, meetings and personal plans. Finding out who can grab food, study, play ball or just link up usually means:

- sending "are you free?" to a group chat and waiting for replies,
- swapping screenshots of timetables or rosters that go out of date within a week,
- doing mental arithmetic across 3–20 people's schedules to find a gap that works for everyone.

Calendar apps don't fix this. Google Calendar sharing works one person at a time, is clumsy on mobile, and knows nothing about the schedules that only exist as a **PDF, screenshot or photo**, which is how most class timetables and work rosters arrive.

### Product in one sentence
whosfree is an installable web app (PWA). It turns your schedule files and your Google Calendar into a live free/busy status, shares that status with the friends and groups you pick at the level of detail you pick, and lets you ping a free friend or find a time when the whole group is free.

---

## 2. Goals & non-goals

### Goals (MVP)
| # | Goal |
|---|---|
| G1 | A user goes from a schedule file to an accurate schedule in **under 3 minutes**, including reviewing and fixing the parse. |
| G2 | A user sees which friends are free **now** and **later today**, and until when, within one tap of opening the app. |
| G3 | A user can **ping** a free friend, with a template or a short message, in one tap. |
| G4 | A user can find **shared free slots** for a group of up to 20 people. |
| G5 | Users control **exactly what each group and friend sees**. Privacy is the default, not a setting you have to find. |
| G6 | Growth comes from **invite links** shared on WhatsApp and in group chats. |

### Non-goals (MVP)
| # | Non-goal | Why |
|---|---|---|
| NG1 | Live location sharing, or storing or sharing where an event takes place (room or address) | Safety risk. whosfree shares *availability*, not *whereabouts* (D1). We don't store locations at all (D35). |
| NG2 | A full calendar editor or a replacement for Google Calendar | We read calendars. We don't manage them. |
| NG3 | Full chat or messaging threads | WhatsApp already covers chat. Pings with short text are a nudge, not a conversation (D14). |
| NG4 | Integrations with institutions (school SIS, employer HR or rostering systems) | These need partnerships. Revisit after traction. |
| NG5 | Native iOS or Android apps | A PWA is enough to test the idea. |
| NG6 | .ics import and Outlook | After the MVP (D3). See [§12](#12-out-of-scope--future-ideas). |
| NG7 | Monetisation | Deferred until there's evidence of product–market fit (D16). |

---

## 3. Users & personas

**Target users:** adults (**18+**, D13) in Jamaica who coordinate free time with friends, classmates, teammates or co-workers, and whose schedules come from structured sources such as class timetables, work rosters or Google Calendar. **The product isn't limited to any one institution or type of user** (D11). Students are one important example among several.

| Persona | Description | Key need |
|---|---|---|
| **Kemar, the packed schedule** | 20, university student. Labs most days and a part-time job at weekends. His timetable is a PDF from a student portal. | Wants friends to see when he's free instead of asking him. |
| **Aaliyah, the organiser** | 26, works 9–5 and keeps everything in Google Calendar. She's the one who plans food runs and outings. | Wants to find a slot that suits 6 people without 40 messages. |
| **Jordan, the shift worker** | 23, call-centre agent. His roster changes every week and arrives as a photo or PDF. | Needs *dated* schedules (not weekly repeats) to be supported (D28). |
| **Shanice, the group lead** | 30, runs a church youth group and a netball team, with people she doesn't know well. | Wants shared availability **without** exposing her personal calendar details to near-strangers. |

Shanice is why every group gets its own visibility tier, chosen when you join it (D1, D20). Jordan is why the parser has to cope with rosters as well as weekly timetables (D28).

---

## 4. Assumptions & constraints

### Assumptions
| # | Assumption | Status |
|---|---|---|
| A1 | Most users are on **Android with Chrome**, with a significant minority on iOS Safari. | [ASSUMPTION], check in beta |
| A2 | **Mobile data costs matter.** Many users are on prepaid plans and Wi-Fi is inconsistent. | [ASSUMPTION] |
| A3 | Most users have a **Google account**. Some accounts are managed by a school or workplace and may block third-party apps (R11). | [ASSUMPTION] |
| A4 | Schedules arrive as **PDFs, screenshots of portals or apps, photos of printed sheets, or spreadsheets exported to PDF**, in no standard format. | Likely. Collect samples (§13). |
| A5 | Jamaica is **UTC−5 all year, with no DST**. We still store everything in UTC and show it in the user's timezone. | Fact. Design stays timezone-safe. |
| A6 | Schedules come in two shapes: **recurring** (a weekly class timetable, a fixed work pattern) and **dated** (a roster for specific dates, a list of one-off events). | Likely. Both are supported: recurring is a Must, dated is a Should (D28). |
| A7 | People are happy to share Free/Busy with times, and more hesitant about sharing details. | [ASSUMPTION], which is why D1 and D20 exist |

### Constraints
- **Fixed stack** (D6, D15, D19, D46): Next.js on Vercel, Supabase (Postgres), Clerk, OpenRouter, all in one monorepo. There is no separate worker service (D46).
- **Google OAuth verification** is required for the `calendar.readonly` scope (D8). Until it's approved, the app is capped at **100 test users** and shows an "unverified app" warning.
- **Jamaica Data Protection Act 2020** applies (D9). See NFR-COMP.
- **18+ only** (D13).
- **No deadline** (D10), but the MVP scope is kept deliberately tight.

---

## 5. User journeys (MVP)

### J1: Onboarding (first-time user, usually arriving from an invite link)
1. Taps an invite link on WhatsApp, e.g. `whosfree.app/i/abc123`. The **invite page** (FR-WEB-3) says "Aaliyah invited you to *Flat 4* on whosfree".
2. **Signs up** with Google through Clerk, enters their date of birth to confirm they're 18 or over, and accepts the terms and privacy notice (FR-WEB-2, FR-AUTH-6).
3. Answers **"When are you usually up and about?"** using a slider pre-set to **08:00–22:00 every day**. These become their available hours, which they can later change day by day (FR-AVL-2, D24).
4. **Uploads a schedule** (a PDF, photo or screenshot), or skips this and adds one later.
5. **Reviews the parsed schedule** and fixes anything wrong, then confirms.
6. Optionally **connects Google Calendar**.
7. **Chooses what *Flat 4* can see** (FR-VIS-1, D20). *Free/Busy with times* is selected by default. They can raise it to "Category" or "Details", then join.
8. Is prompted to **install the PWA** and **allow notifications**.
9. Lands on the **Now** screen.

### J2: "Who's free right now?"
1. Opens the app. The **Now** screen shows:
   - **Free now**, with "until 2:00 PM" (D18),
   - **Free soon**, with "from 1:30 PM",
   - **Busy** or **Away**, with "until 3:00 PM" plus a reason if that person's tier allows it,
   - people whose **schedule isn't added yet** or who have **paused sharing** (D22).
   - A small ⚠️ **"Schedule may be out of date"** appears only on friends whose data is stale (D25).
2. Can filter the list by group.

### J3: Ping
1. Taps a free friend, then **Ping**.
2. Picks a template ("Free for food?", "Wanna study?", "Link up?", "Call me"), writes a **short message** of up to 140 characters, or does both (D14, D31).
3. The friend gets a push notification and replies in one tap ("I'm down", "In 10", "Can't right now"), or with a short text of their own.
4. The sender gets the reply as a notification.

### J4: Group slot finder
1. Opens a group (or picks some people) and taps **Find a time**.
2. Sets a date range (default: the next 7 days), a minimum duration (default: 60 min), and optionally a time-of-day window.
3. Sees a ranked list of slots. Slots where everyone is free come first, then slots where all but one or two people are free, with the names of who can't make it.
4. Taps a slot and shares it, either as a group ping (if they have permission) or as copied text for WhatsApp.

### J5: Manual status
1. Taps their own status chip from anywhere in the app.
2. Sets one of **Free**, **Busy**, **Do not disturb**, **Away** or **Studying/Focused**, optionally with an end time ("until 4 PM"). This overrides whatever the calendar says (D5).

### J6: New schedule period
1. As the end date of the current schedule approaches (end of semester, end of roster), gets a nudge: "Your schedule ends Dec 12. Upload the new one?"
2. Uploads the new file, reviews it and confirms. The old recurring events stop at the end date. They can **re-upload at any time**, not only when prompted.

### J7: Group admin
1. Creates a group and becomes its **admin** (D17).
2. Shares the invite link. New members can **invite** and **ping the group** by default. The admin can also grant **manage members** and **edit group**, or take any of these away (D26).
3. Can remove members, regenerate the invite link, transfer admin to someone else, or delete the group.


### J8: Friend who isn't on whosfree (D44)
1. Taps **Add a friend who isn't on whosfree**, types a nickname ("Tash"), and confirms they have Tash's permission to add her schedule.
2. Uploads a photo or PDF of Tash's timetable (or types it in), reviews the draft and confirms, exactly as for their own schedule.
3. Tash appears on their Now screen in a **Not on whosfree** section ("Free until 2:00 PM") and in Find a time. Nobody else can see her.
4. Taps **Invite Tash to whosfree** to send her a link. If she joins and they become friends, they're offered to delete the offline copy.
---

## 6. Functional requirements

### 6.1 Public web pages (WEB) (D21)
| ID | Requirement | Priority |
|---|---|---|
| FR-WEB-1 | A **landing page** at `/` for signed-out visitors, covering what the app does, how it works in three steps, the privacy promise, a sign-up button and install instructions. Rendered statically so it loads fast. | M |
| FR-WEB-2 | **Sign-in and sign-up pages** built on Clerk components (D19). Sign-up includes the age confirmation and acceptance of the terms and privacy notice. | M |
| FR-WEB-3 | An **invite page** at `/i/[code]`. It works signed out and shows only the inviter's name, the group's name and emoji, and the member count. It **never** shows anyone's schedule. The invite is remembered through sign-up and onboarding. | M |
| FR-WEB-4 | **Legal pages**: privacy policy (including Google's Limited Use disclosure), terms of service and a contact page. Google's verification requires these (NFR-COMP-6). The source text lives in [docs/legal/privacy-policy.md](docs/legal/privacy-policy.md) and [docs/legal/terms.md](docs/legal/terms.md) (drafts pending legal review, WF-119). | M |
| FR-WEB-5 | **Onboarding flow** pages (J1). | M |
| FR-WEB-6 | **Help/FAQ**, including a step-by-step guide to installing the app on iOS and a page explaining privacy tiers. | S |
| FR-WEB-7 | **Link previews** (Open Graph) for invite links, so WhatsApp shows "Join *Flat 4* on whosfree". The group name becomes visible to anyone who has the link. | S |
| FR-WEB-8 | A **404 page and error pages** that point people somewhere useful. | M |
| FR-WEB-9 | **Navigation:** desktop uses the left sidebar from the design. On phones the app follows the design (`Who's Free scheduling UI/`) **except** for its bottom navigation bar: there is no bottom bar, and the same destinations and groups open from a **hamburger menu** in the top header, as a drawer. | M |

### 6.2 Authentication & profile (AUTH) (D19)
| ID | Requirement | Priority |
|---|---|---|
| FR-AUTH-1 | Users sign in through **Clerk**, with **Google** or with an **email address and password** (D45). Email addresses are verified before the account is used. Google sign-in asks for basic profile and email scopes only, **never** calendar scopes (those come later, FR-GCAL-1). | M |
| FR-AUTH-2 | The profile has a display name (from Google, or the full name entered at email sign-up), an avatar (taken from Google when there is one, can be replaced) and a **handle** (`@kemar`). Every new account gets a unique handle generated from its name, which the user can change to any handle nobody else has, but not remove (D47). | M |
| FR-AUTH-3 | Users have a **timezone**, detected automatically and defaulting to `America/Jamaica`. | M |
| FR-AUTH-4 | Sign-in by email magic link or one-time code, using Clerk's built-in support. | S |
| FR-AUTH-5 | Sessions last across PWA launches, so users don't have to sign in every time they open the app. | M |
| FR-AUTH-6 | **Age check** (D29): sign-up asks for a **self-declared date of birth**, and anyone under 18 is turned away with a clear message. We store only `birthYear` and `ageConfirmedAt`, never the full date of birth. Accounts reported or found to be under 18 are suspended and then deleted. | M |

### 6.3 Social graph & groups (SOCIAL) (D2, D17)
| ID | Requirement | Priority |
|---|---|---|
| FR-SOC-1 | Users send and accept **friend requests**, which both sides must agree to, by handle, invite link or QR code. When accepting, each side **chooses the tier** the other will see (FR-VIS-1). | M |
| FR-SOC-2 | Users can **create groups** with a name, an emoji or icon and members. | M |
| FR-SOC-3 | Groups have an **invite link** that can be revoked or regenerated, with optional expiry and a maximum number of uses. | M |
| FR-SOC-4 | Invite links have a one-tap **Share to WhatsApp**, using the Web Share API with a `wa.me` fallback. | S |
| FR-SOC-5 | Joining a group **does not** make you friends with its members. Group members see each other at whatever tier each member chose for that group. | M |
| FR-SOC-6 | Users can **leave** groups, **remove** friends and **block** users. Blocked users can't see, ping or invite you, and they aren't told they've been blocked. | M |
| FR-SOC-7 | **One admin per group.** The group's creator is the admin by default and can **transfer** the role. An admin who wants to leave must transfer it first. If the admin deletes their account, the role passes to the longest-standing member. | M |
| FR-SOC-8 | **Member permissions**: the admin can grant or revoke any of these for each member: `invite` (create or share invite links), `manageMembers` (remove members), `editGroup` (change name and emoji), `groupPing` (ping every free member at once). **New members start with `invite` ✓, `groupPing` ✓, `manageMembers` ✗, `editGroup` ✗** (D26). | M |
| FR-SOC-9 | The admin always holds every permission and can also **delete the group** and **regenerate or revoke invites**. | M |
| FR-SOC-10 | **Being admin gives no extra visibility.** Admins see members at the tier each member chose, exactly like everyone else. | M |
| FR-SOC-11 | **Groups are capped at 20 members** (D17). When a group is full, invite links show "This group is full". The cap is a config value so it can be raised later. | M |
| FR-SOC-12 | Suggest friends based on the groups you share. | C |
| FR-SOC-13 | **Join requests**: the admin can switch a group to "approval required", and joins then need approval from the admin or someone with `manageMembers`. | C |
| FR-SOC-14 | **Offline friends** (D44): a user can add a person who isn't on whosfree, identified only by a **nickname** they choose, and give them a schedule by **uploading their timetable** (same parse → review → confirm flow as FR-IMP) or by **manual entry**. | M |
| FR-SOC-15 | An offline friend and their schedule are **visible only to the user who added them**: never shown to anyone else, never searchable, never matched or merged with a real account, and never shared at any tier. The uploader sees full detail (it's their own data). | M |
| FR-SOC-16 | Adding an offline friend requires the user to **confirm they have that person's permission** to store their schedule, and the terms forbid adding someone's schedule without it. | M |
| FR-SOC-17 | Offline friends appear on the **Now screen** in their own "Not on whosfree" section, have a **detail page**, and can be chosen in the **slot finder**. They can't be pinged; instead there is an **Invite to whosfree** action. | M |
| FR-SOC-18 | Users can **edit, re-upload or delete** an offline friend at any time. Deleting removes their schedule straight away. A user can have at most **20 offline friends** (a config value). **[ASSUMPTION]** | M |
| FR-SOC-19 | When an offline friend joins and becomes a real friend, the user is offered to **delete the offline copy**; the two are never merged automatically. | S |

### 6.4 Schedule import & parsing (IMPORT) (D3, D7, D35, D38)
| ID | Requirement | Priority |
|---|---|---|
| FR-IMP-1 | Users upload **PDF, PNG, JPG/JPEG, HEIC or WebP** files up to **10 MB**. PDFs can be up to **5 pages**. **[ASSUMPTION]** | M |
| FR-IMP-2 | Users can **take a photo** of a printed schedule with the camera, via the `capture` attribute on the file input. | S |
| FR-IMP-3 | The system extracts **structured events**: title, category (class, lab, tutorial, work/shift, meeting, other), start and end time, and a recurrence pattern or specific date. **Rooms, addresses, ID numbers and other personal details in the file are ignored and never stored** (D35). | M |
| FR-IMP-4 | The parser **must not depend on layout** (D7). It has to handle grids with days as columns or rows, lists and different institutions' formats. | M |
| FR-IMP-5 | **Recurring schedules**: weekly, alternating weeks (A/B or odd/even), and specific week numbers ("weeks 1–6, 8–12"). Week 1 is the Monday–Sunday week that contains the schedule's start date, and week A is an odd week (D42). | M |
| FR-IMP-6 | **Dated schedules** (rosters, one-off event lists): events on specific calendar dates that don't repeat. Built in Phase 1 **after** recurring schedules, and only if the eval set shows it's workable (D28). | S |
| FR-IMP-7 | The user sets or confirms the **date range the schedule covers** (e.g. semester start and end). The parser suggests dates if the file contains them. | M |
| FR-IMP-8 | Users can add **exceptions** such as breaks, holidays or exam periods. Jamaican public holidays are pre-filled. | S |
| FR-IMP-9 | Every parse produces a **draft**. Nothing reaches the user's schedule until they **review and confirm** it (D7). | M |
| FR-IMP-10 | The review screen shows a **preview grid** with low-confidence events highlighted ("We weren't sure about this one"), next to the original file so the user can compare. | M |
| FR-IMP-11 | During review the user can **edit, delete, add, split and merge** events. | M |
| FR-IMP-12 | **Manual entry** is a fully supported alternative for anyone without a file or whose parse failed. | M |
| FR-IMP-13 | Parsing runs **in the background** with live progress (queued, processing, ready for review, failed). The user can leave and come back. | M |
| FR-IMP-14 | When a parse fails, the user sees a clear message with three options: retry, try a different file, or enter the schedule manually. | M |
| FR-IMP-15 | **Raw files are deleted on confirm** (D38). An uploaded file is kept only while it's needed for parsing and review, and is **deleted as soon as the user confirms the schedule**. Files that are never confirmed (abandoned or failed) are deleted **7 days after upload** **[ASSUMPTION]**. The parse draft is deleted along with the file. | M |
| FR-IMP-16 | A **"Pending uploads"** list of files that haven't been confirmed yet, with the date each will be deleted. The user can delete any of them at any time. | M |
| FR-IMP-17 | **Re-upload any time**. A new schedule ends the old recurring events at a date the user picks, and past history is kept. | M |
| FR-IMP-18 | ~~Re-parse a stored file after it's been confirmed.~~ **Dropped** (D38): confirmed files no longer exist. Retrying a *pending* file is still covered by FR-IMP-14. | W |
| FR-IMP-19 | **Rate limit**: 5 parse attempts per user per day, to keep AI costs under control (NFR-COST-1). **[ASSUMPTION]** | M |
| FR-IMP-20 | Users can opt in to **contributing an anonymised sample** to improve the parser. Off by default and needs explicit consent. | C |
| FR-IMP-21 | **Shared schedule templates**: once one user confirms a common schedule, such as a course's sections or a team's fixed training times, others can reuse it. | C |

### 6.5 Google Calendar integration (GCAL) (D3, D8)
| ID | Requirement | Priority |
|---|---|---|
| FR-GCAL-1 | Users connect Google Calendar **separately from sign-in**, through **our own OAuth flow** (D30) with incremental authorisation and the `calendar.readonly` scope, after an explanation of what we read and why. We don't use Clerk's Google tokens for calendar access. | M |
| FR-GCAL-2 | Users choose **which calendars** to include. The primary calendar is selected by default. | M |
| FR-GCAL-3 | The **initial sync** covers a rolling window from 7 days ago to 60 days ahead **[ASSUMPTION]**, with recurring events expanded into individual instances. | M |
| FR-GCAL-4 | **Incremental sync** uses Google sync tokens. If Google returns `410 Gone`, it falls back to a full re-sync. | M |
| FR-GCAL-5 | **Near-real-time updates** come from Google push notifications (`events.watch`) to a webhook route on the Next.js server. Channels are renewed before they expire, and there's a **polling fallback** every 15 minutes. **[ASSUMPTION]** | S |
| FR-GCAL-6 | These don't count as busy: events marked "free" or transparent, events the user declined, and **all-day events** (users can opt in to counting all-day events). | M |
| FR-GCAL-7 | Synced event **titles are never shown beyond the tier each viewer has** (D1, D8). The default is Free/Busy with times. | M |
| FR-GCAL-8 | Users can mark a calendar or a single event as **always private**, which always shows as "Busy" whatever the tier. | S |
| FR-GCAL-9 | **Disconnecting** revokes the token and **deletes all synced Google data** within 24 hours. | M |
| FR-GCAL-10 | Sync health is visible to the user ("Last synced 2 min ago", "Reconnect needed"). Viewers see a warning only when the data is stale (FR-VIEW-8, D25). | S |
| FR-GCAL-11 | Google Calendar data is **never** sent to the AI parser, OpenRouter or any other third party (Google's Limited Use policy, NFR-COMP-5). | M |
| FR-GCAL-12 | **Store as little as possible** (D36). For each Google event we store only the **start and end time, whether it counts as busy, the private flag and Google's event ID**. The category is always `event` (so T2 viewers see "Busy · Calendar event"). We **never store** descriptions, attendees, locations, conference links or attachments. They're dropped during sync and never written to the database. | M |
| FR-GCAL-13 | **Titles only when needed** (D36). An event's **title is stored only if the owner has given at least one friend or group the Details tier (T3)**. When the first T3 is granted, a re-sync fetches titles. When the last T3 is removed, stored Google titles are deleted within 24 hours. | M |

### 6.6 Availability engine (AVAIL) (D5, D18, D22)
The engine is a **pure, deterministic TypeScript package** (`packages/availability`). It takes a user's events, preferences and overrides plus a time range, and returns intervals with a status. It performs no I/O.

**Statuses**
| Status | What viewers see | Meaning |
|---|---|---|
| `free` | "Free until 2:00 PM" | Within available hours, with no busy event and no override. |
| `busy` | "Busy until 3:00 PM" (plus a reason, depending on tier) | A busy event from any source, or a manual "Busy" or "Studying/Focused" status. |
| `dnd` | "Do not disturb until 5:00 PM" | Set manually. The user can't be pinged. |
| `away` | "Away until 8:00 AM" | Outside available hours, or a manual "Away" status. |
| `no_schedule` | "Hasn't added a schedule yet" | The user has no schedule source and no active manual status (D22). |
| `paused` | "Sharing paused" | The user has paused sharing (FR-VIS-6). |

**Precedence (highest first):** `paused` → manual status override → `no_schedule` (no sources) → busy events (from any source) → available-hours window → `free`.

| ID | Requirement | Priority |
|---|---|---|
| FR-AVL-1 | Combines events from **every source** (uploaded schedule, manual entries, Google Calendar) into one timeline, merging busy blocks that overlap. | M |
| FR-AVL-2 | **Available hours**: the part of each day a user is willing to show as free. Outside those hours they show as `away`, so nobody appears "free" at 3 AM. During onboarding they're set with a **"When are you usually up and about?"** slider, **pre-set to 08:00–22:00 every day** (D24). The user can edit each day separately at any time. | M |
| FR-AVL-3 | **Manual status**, either with an end time or "until I change it", overrides everything below it in the precedence order (D5). | M |
| FR-AVL-4 | Works out the **current status plus "until X"**, and viewers see the "until X" (D18). | M |
| FR-AVL-5 | Works out free intervals over a **time range** for one user or several (this powers the slot finder). | M |
| FR-AVL-6 | Expands **recurring events** within the requested range, taking into account schedule date ranges, week patterns and exceptions. | M |
| FR-AVL-7 | Optional **buffer** before and after events (e.g. 10 minutes of travel). | C |
| FR-AVL-8 | Gaps shorter than N minutes (default 15) count as busy, because a 5-minute gap isn't really free time. **[ASSUMPTION]** | S |
| FR-AVL-9 | Everything is computed in UTC and converted only for display. Timezone and DST bugs are tested explicitly, even though Jamaica has no DST. | M |

### 6.7 Visibility & privacy controls (VIS) (D1, D20)
**Tiers**
| Tier | What the viewer sees | Example |
|---|---|---|
| **T1: Free/Busy with times** (baseline default) | Status and "until X" only | "Busy until 3:00 PM" |
| **T2: Category** | T1 plus the kind of event | "In class until 3:00 PM", "At work", "In a meeting" |
| **T3: Details** | T2 plus the event title | "COMP2140 Lecture until 3:00 PM" |

Location or room is **never stored or shared**, at any tier (NG1, D35).

| ID | Requirement | Priority |
|---|---|---|
| FR-VIS-1 | **Choose before connecting** (D20). Before joining a group or accepting a friend request, the user picks the tier that group or friend will see. **T1 is preselected**, and it's the **minimum** for any active connection. | M |
| FR-VIS-2 | Users can **change** a group's or friend's tier at any time from group settings or the "Who can see me" page. | M |
| FR-VIS-3 | **When tiers overlap** (D27): a tier set for an individual friend always wins. Otherwise, if a viewer shares several groups with the user, the **most restrictive** of those groups' tiers applies. | M |
| FR-VIS-3a | **Overlap hint**: whenever the rule in FR-VIS-3 lowers what someone sees, the owner gets an explanation in "Who can see me" and in the "How others see me" preview, e.g. "Alice sees Free/Busy because you're both in *Netball*", with a one-tap "Set a tier for Alice" action. | M |
| FR-VIS-4 | **Per-event and per-calendar privacy** ("always show as Busy") overrides every tier (FR-GCAL-8). | S |
| FR-VIS-5 | Visibility is **enforced on the server**. Queries never send the client more than the tier a viewer is allowed. | M |
| FR-VIS-6 | Users can **pause sharing**, which shows `paused` to everyone, and resume whenever they like. This is the only exception to the T1 minimum. | S |
| FR-VIS-7 | **"How others see me"** preview: view your own schedule as a particular friend or group would see it. | S |
| FR-VIS-8 | A **"Who can see me"** page lists every friend and group with the tier that actually applies to each. | M |

### 6.8 Views (VIEW)
| ID | Requirement | Priority |
|---|---|---|
| FR-VIEW-1 | **Now screen** (home), with sections for *Free now*, *Free soon (within 60 minutes)*, *Busy/Away*, and *Not sharing yet* (`no_schedule` or `paused`). Every status shows "until X" (D18). | M |
| FR-VIEW-2 | The Now screen can be **filtered by group**. | M |
| FR-VIEW-3 | **Real-time updates**: a friend's status change appears without refreshing. | M |
| FR-VIEW-4 | **Friend detail**: that friend's timeline for today and tomorrow, at your tier. | M |
| FR-VIEW-5 | **My schedule**: day and week views of my combined schedule, with a badge showing where each event came from. | M |
| FR-VIEW-6 | **Group view**: today's timeline for every member, with free overlaps highlighted. | S |
| FR-VIEW-7 | Empty states that lead to invites ("None of your friends are here yet. Share your invite link"). People with `no_schedule` get a "Nudge them to add a schedule" action. | M |
| FR-VIEW-8 | **Stale-data warning** (D25): healthy data shows **no timestamp**. A small ⚠️ "Schedule may be out of date" appears next to a person's status only when a source (1) has failed to sync, (2) hasn't synced in **more than 24 hours**, or (3) has passed its end date. The same flag is shown in the slot finder. | S |

### 6.9 Pings (PING) (D4, D14)
| ID | Requirement | Priority |
|---|---|---|
| FR-PING-1 | You can ping any **friend or fellow group member** who is `free`. Pinging someone `busy` or `away` is allowed after a confirmation. Pinging someone on `dnd` or `paused` is **blocked**. | M |
| FR-PING-2 | A ping is a **template**, **free text**, or both (D14). Following D31, free text is **capped at 140 characters** and always shown as plain text: never HTML, and **URLs are not clickable**. No automatic profanity filter in the MVP. Abuse is handled by one-tap report and block (FR-PING-8). | M |
| FR-PING-3 | Pings arrive as **Web Push** notifications and in an in-app inbox. | M |
| FR-PING-4 | Recipients reply in **one tap** ("I'm down", "In 10", "Can't right now") or with short free text. One-tap replies use notification action buttons where the platform supports them, and the app otherwise. | M |
| FR-PING-5 | **Group ping**: ping every free member of a group at once. Requires the `groupPing` permission (FR-SOC-8). | S |
| FR-PING-6 | **Rate limits**: at most 3 pings per sender per recipient per hour, and 30 per sender per day. **[ASSUMPTION]** | M |
| FR-PING-7 | Recipients can **mute** a person or a group and set **quiet hours**. | M |
| FR-PING-8 | Users can **report** a ping, which sends it with context to the moderation queue (FR-SET-4). Blocking someone from a ping takes one tap. | M |
| FR-PING-9 | Pings expire after 2 hours. **[ASSUMPTION]** | S |

### 6.10 Group slot finder (SLOT) (D4)
| ID | Requirement | Priority |
|---|---|---|
| FR-SLOT-1 | Inputs: participants (a group or chosen people, **up to 20**, matching the group cap), a date range (up to 14 days), a minimum duration, and an optional time-of-day window. | M |
| FR-SLOT-2 | Output: a ranked list. Slots where **everyone** is free come first, ordered by soonest and then longest. After those come **"all but N"** slots, naming who can't make it. | M |
| FR-SLOT-3 | The slot finder only reveals *when* people are free. It **never reveals why** someone is busy beyond what each viewer's tier allows. | M |
| FR-SLOT-4 | Participants with `no_schedule` or `paused` are flagged ("2 people haven't added a schedule yet") and left out of the calculation. | M |
| FR-SLOT-5 | A chosen slot can be **shared** as a group ping (with `groupPing`) or copied as text for WhatsApp. | S |
| FR-SLOT-6 | **Quick polls**: members vote on 2–3 suggested slots. | C |
| FR-SLOT-7 | Export a confirmed slot as a `.ics` invite or a Google Calendar event. | C |

### 6.11 Progressive Web App (PWA)
| ID | Requirement | Priority |
|---|---|---|
| FR-PWA-1 | **Installable**: manifest, icons, splash screen, `display: standalone`. | M |
| FR-PWA-2 | A service worker caches the **app shell** and the **last-known Now data**, so the app opens offline with a "Last updated 5 min ago" banner. | M |
| FR-PWA-3 | **Install prompt**: Android uses the native `beforeinstallprompt` prompt. iOS gets a step-by-step "Add to Home Screen" guide, because iOS only allows push notifications for installed apps. | M |
| FR-PWA-4 | **Web Push** permission is requested through an explanation screen first, never on first load. | M |
| FR-PWA-5 | **Web Share Target**: sharing a screenshot of a schedule *into* whosfree from the phone's share sheet starts the import flow. | C |
| FR-PWA-6 | An app **update** flow: "New version available. Tap to refresh". | S |

### 6.12 Settings, data rights & safety (SET)
| ID | Requirement | Priority |
|---|---|---|
| FR-SET-1 | Users can **export all their data** as a JSON bundle, plus any pending (unconfirmed) files (NFR-COMP-2). Until this is built (WF-113), export requests are **handled manually by email within 30 days** (D39). | M |
| FR-SET-2 | Users can **delete their account**. They're removed from every group straight away, pending files are deleted straight away, and all other data is permanently deleted within 30 days. Until this is built (WF-114), deletion requests are **handled manually by email within 30 days** (D39). | M |
| FR-SET-3 | Notification settings per type: pings, friend requests, group invites and schedule-expiry reminders. | M |
| FR-SET-4 | **Report** a user, a group or a ping, and review reports in an admin queue. Now a Must because pings allow free text (D14). | M |
| FR-SET-5 | Links to the privacy notice and terms inside the app, plus a **record of consent** (which version was accepted and when). | M |

### 6.13 Admin & operations (ADMIN)
| ID | Requirement | Priority |
|---|---|---|
| FR-ADM-1 | An internal admin view for users, groups, parse jobs (status and failure reason) and reports. | S |
| FR-ADM-2 | **Feature flags** to roll out features gradually (slot finder, Google Calendar and so on). | S |
| FR-ADM-3 | **Parser eval dashboard** showing accuracy on the sample set (§13) for each model and prompt version. | S |
| FR-ADM-4 | Daily **retention jobs** delete unconfirmed files older than 7 days (FR-IMP-15), past events older than 90 days, and pings older than 30 days (D32). Each job records what it deleted. | M |

---

## 7. Non-functional requirements

### 7.1 Privacy & security (SEC)
| ID | Requirement |
|---|---|
| NFR-SEC-1 | **Privacy by default and minimal data**: new connections start at T1 (D20), locations are never stored (D35), Google data is kept to the minimum (D36), raw files are deleted on confirm (D38), and sharing more is always opt-in. |
| NFR-SEC-2 | **Every read and write checks authorisation.** Row-level security (RLS) is on for every table, and the client is never trusted. Other users' data can only be read through database functions that apply the tier filter (FR-VIS-5, D41). The Supabase service-role key is used only on the server, never in the browser. |
| NFR-SEC-3 | **Google OAuth refresh tokens** (we store them ourselves, D30) are encrypted in the application (AES-256-GCM, key held in an environment secret) and never sent to the client. |
| NFR-SEC-4 | TLS everywhere. Data at rest is encrypted by the providers (Supabase). |
| NFR-SEC-5 | **Internal routes** (cron sweeps, parse-job dispatch) are authenticated with a shared secret (`CRON_SECRET`) compared in constant time, and do nothing for unauthenticated callers. The browser never calls them (D46). |
| NFR-SEC-6 | **Uploaded files** are validated by their magic bytes (not just the file extension), size-limited, stored privately and accessible only to the owner and the server, through short-lived URLs. Uploads go straight from the browser to Storage through a signed upload URL, never through a server function (D46). Files are deleted when the schedule is confirmed, or 7 days after upload if it never is (D38). |
| NFR-SEC-7 | **The AI parser treats file content as untrusted.** The model gets no tools and no other data, its output must match a strict zod schema, and nothing it returns is executed or rendered as HTML. |
| NFR-SEC-8 | **The OpenRouter API key** exists only in the Next.js server's environment (never a `NEXT_PUBLIC_` variable, D46). Requests are routed only to providers that **don't store or train on prompts** (configured through OpenRouter's data-collection and zero-data-retention settings). Check what these settings actually guarantee before launch. |
| NFR-SEC-9 | Every write that could be abused (pings, friend requests, invites, parses) is **rate-limited**. |
| NFR-SEC-10 | Dependencies are scanned (Dependabot or Renovate), and CI scans for secrets. |
| NFR-SEC-11 | Logs never contain event titles, ping text, file contents or tokens. |
| NFR-SEC-12 | **No IP addresses in analytics or error tracking** (D37). PostHog runs with IP capture turned off, and Sentry with `sendDefaultPii: false` and IP storage disabled in the project settings. |

### 7.2 Performance (PERF)
| ID | Requirement |
|---|---|
| NFR-PERF-1 | **LCP ≤ 2.5 s** for the Now screen and the landing page on a mid-range Android phone over "Fast 3G" (A2). |
| NFR-PERF-2 | The first route loads **≤ 200 KB of gzipped JS**. **[ASSUMPTION]** |
| NFR-PERF-3 | A status change reaches friends' screens in **≤ 5 s** (Supabase Realtime signal, then a re-fetch). |
| NFR-PERF-4 | A parse job goes from upload to "ready for review" in **≤ 60 s at the 95th percentile**. |
| NFR-PERF-5 | The slot finder responds in **≤ 1 s** for 20 people over 14 days. |
| NFR-PERF-6 | Images are compressed on the device before upload (e.g. a 4000 px photo shrinks to ≤ 2000 px). |

### 7.3 Reliability & availability (REL)
| ID | Requirement |
|---|---|
| NFR-REL-1 | **99.5% monthly availability** for the core app during the beta. |
| NFR-REL-2 | Parse jobs are **idempotent** and **retried** with backoff up to 3 times. OpenRouter **fallback models** are configured so a single provider outage doesn't stop parsing. |
| NFR-REL-3 | A failed Google Calendar sync doesn't break the rest of the app, and stale data is flagged (FR-GCAL-10, FR-VIEW-8). |
| NFR-REL-4 | If a parse run fails, crashes or times out, the job stays queued (or its lease expires) and a cron sweep re-dispatches it with backoff, up to 3 attempts (D46). |

### 7.4 Scalability (SCALE)
| ID | Requirement |
|---|---|
| NFR-SCALE-1 | The beta design handles **5,000 users and 500 concurrent** without architectural changes. **[ASSUMPTION]** |
| NFR-SCALE-2 | Parse runs hold no state between requests: everything lives in the `parseJobs` row and Storage, so any server instance can pick a job up (D46). |
| NFR-SCALE-3 | Availability is calculated **when read**, for small windows. "Now" statuses are cached or precomputed only if profiling shows it's needed. |
| NFR-SCALE-4 | The 20-member group cap is a config value (FR-SOC-11). Raising it must not require a schema change. |

### 7.5 Usability & accessibility (UX)
| ID | Requirement |
|---|---|
| NFR-UX-1 | **WCAG 2.1 AA** for contrast, focus states and screen-reader labels. Status is **never shown by colour alone**, so it always comes with an icon or text. |
| NFR-UX-2 | Designed for mobile first. Tap targets are at least 44×44 px and everything works one-handed. |
| NFR-UX-3 | Light and dark themes that follow the system setting. |
| NFR-UX-4 | Copy is plain, friendly and short. Jamaican English and local flavour are fine ("Link up?"). |

### 7.6 Compatibility (COMPAT)
| ID | Requirement |
|---|---|
| NFR-COMPAT-1 | **Android Chrome** (last 2 major versions), **iOS Safari 16.4+** (needed for Web Push), and desktop Chrome, Edge, Firefox and Safari (last 2 versions). |
| NFR-COMPAT-2 | Users who can't get push notifications (older iOS, or iOS without installing the app) still receive pings in the in-app inbox. |

### 7.7 Compliance (COMP) (D9, D13, D35–D38)
> ⚠️ **Check every item here with a Jamaican data-protection lawyer before public launch.** It's a starting checklist, not legal advice.

| ID | Requirement |
|---|---|
| NFR-COMP-1 | **Jamaica Data Protection Act 2020 (DPA)**: register as a data controller with the **Office of the Information Commissioner (OIC)**, and appoint a Data Protection Officer if required. |
| NFR-COMP-2 | **Data-subject rights**: access, correction, erasure and objection, handled through FR-SET-1, FR-SET-2 and FR-IMP-16 plus a contact email address. |
| NFR-COMP-3 | **Breach notification**: an internal runbook for notifying the OIC within the required time (believed to be **72 hours**, needs confirming). |
| NFR-COMP-4 | **Sending data abroad**: our processors (Supabase, Vercel or whichever host runs the web app, Clerk, OpenRouter and the model providers it routes to) host data outside Jamaica, mostly in the US. Document the legal basis and disclose it in the privacy notice. |
| NFR-COMP-5 | **Google API Services User Data Policy, including Limited Use**: Google data is used only for features the user sees. It's never used for ads, never sold, and never sent to AI models or OpenRouter. Showing a user's event titles to friends they chose is a feature the user directs. Confirm Google accepts this during verification. |
| NFR-COMP-6 | **Google OAuth verification** for `calendar.readonly`. Needs a privacy policy, a homepage (FR-WEB-1, FR-WEB-4), a verified domain, a demo video showing how the scope is used, and possibly a security assessment. **Start early** (D8, §13). Changing the app's name or logo afterwards may trigger a new review (see D23). |
| NFR-COMP-7 | **Minimum age 18** (D13), enforced at sign-up with a self-declared date of birth (FR-AUTH-6, D29) and stated in the terms. Only the birth year is stored. |
| NFR-COMP-8 | **Data retention** (D32, D36, D38): raw files are **deleted when the schedule is confirmed**, or 7 days after upload if it never is (FR-IMP-15). Google event titles are kept only while a T3 grant exists (FR-GCAL-13). **Past events are purged after 90 days.** **Pings are purged after 30 days.** Google data is deleted on disconnect (FR-GCAL-9). Everything is gone within 30 days of account deletion. The privacy notice states each retention period and the reason for it. |
| NFR-COMP-9 | **Data about people who aren't users** (offline friends, D44): stored only for the user who added them, minimised to a nickname and schedule (no contact details, photos or locations), deleted with that user's account, covered by the retention rules above, and disclosed in the privacy notice and terms. The legal review (WF-119) must confirm the lawful basis, since the person never agreed to our terms. |

### 7.8 Cost (COST)
| ID | Requirement |
|---|---|
| NFR-COST-1 | AI parsing costs **≤ US$0.05 per parse**, enforced with rate limits (FR-IMP-19), page limits (FR-IMP-1), image resizing and caching of identical files (by hash). OpenRouter lets us compare prices across models. **[ASSUMPTION]** |
| NFR-COST-2 | Stay on free or hobby tiers (Vercel Hobby/Pro, Supabase free, Clerk free tier) until the beta shows traction. Check usage monthly. |
| NFR-COST-3 | Storage cost stays small because files are deleted on confirm (D38). Alert if unconfirmed files pile up. |

### 7.9 Maintainability & observability (OPS)
| ID | Requirement |
|---|---|
| NFR-OPS-1 | TypeScript `strict` everywhere, with types shared through `packages/shared`. |
| NFR-OPS-2 | The availability engine has **≥ 90% test coverage**, including property-based tests for the interval maths. |
| NFR-OPS-3 | Parser changes, including model or prompt changes on OpenRouter, run against the **eval set** (§13) in CI. A change fails if accuracy drops below the baseline. |
| NFR-OPS-4 | **Error tracking** with Sentry (web app and server) and **product analytics** with PostHog. Analytics never include event titles, ping text, schedule contents or **IP addresses** (NFR-SEC-12, D37). |
| NFR-OPS-5 | Structured logs with a correlation ID that follows a parse job from the upload through the Next.js server to OpenRouter. |
| NFR-OPS-6 | Separate `dev`, `preview` (one per PR) and `prod` environments, each with its own Supabase project (previews use Supabase branching) and Clerk instance. |

---

## 8. Architecture

### 8.1 Overview (D6, D15, D19, D40, D41)

```
                ┌──────────────────────────────────────────┐
                │  Browser / Installed PWA (Android / iOS) │
                │  Next.js app · Service Worker · Web Push │
                └──────┬──────────────┬─────────▲──────────┘
                       │ auth         │ HTTPS   │ realtime (WebSocket):
                ┌──────▼─────┐  ┌─────▼───────┐ │ "changed" signals only
                │   Clerk    │  │ Vercel      │ │
                │ (Google    │  │ apps/web    │ │
                │  sign-in)  │  │ Next.js +   │ │
                └──────┬─────┘  │ server code │ │
                       │ JWT    └──┬───────▲──┘ │
                       │ (3rd-party│auth)  │    │
                ┌──────▼───────────▼───────┴────┴──────────┐
                │ Supabase (primary backend)               │
                │ • Postgres (schema, indexes, RLS)        │
                │ • SQL functions (authz, tier redaction,  │
                │   transactional writes, rate limits)     │
                │ • Storage (private, pending uploads only)│
                │ • Realtime (Broadcast change signals)    │
                │ • Cron (pg_cron + pg_net → server routes)│
                └──────────────────────────────────────────┘
      Next.js server ──► OpenRouter ──► vision LLM   (parse jobs: PDF/HEIC → JPEG in WASM + sharp,
                                                     no-data-retention providers, fallback models, D46)
      Next.js server ──► Google Calendar API  (OAuth, sync, watch webhooks)
      Next.js server ──► Web Push (VAPID) ──► browsers
```

**Why Supabase is the main backend (D40):** the data is relational (friends, groups, members, tiers), and Postgres with row-level security lets us enforce authorisation and tier redaction **inside the database**, so every path (browser, server, cron) goes through the same rules. Supabase also gives us private file storage with short-lived signed URLs, Realtime for the Now screen (FR-VIEW-3), and Cron for sync, renewals and deleting expired files. It's standard Postgres, so we aren't locked in.

**How the pieces fit (D41):**
- **Clerk** signs users in. Supabase trusts Clerk's session tokens through **third-party auth**, and RLS policies identify the user from the Clerk user ID in the token (`auth.jwt()->>'sub'`).
- **Postgres** is the single enforcement point. Users read and write their own rows directly, under RLS. **Other users' data is never selectable directly**: it comes only from `security definer` functions (e.g. `events_for_viewer`) that call `resolve_tier` and `redact`. Anything that must be atomic (committing a schedule, joining a group) is one SQL function, so it runs in one transaction.
- **The Next.js server** runs the TypeScript logic: the availability engine (`packages/availability`), Google Calendar sync, Web Push, and parse jobs (file conversion and the OpenRouter call, D46). For user requests it talks to Supabase **as that user** (with their Clerk token, so RLS applies). The service-role key is used only for background work (webhooks, cron routes, parse runs, and Web Push delivery). Push delivery reads a recipient's devices through one narrow module (`apps/web/src/lib/push/store.ts`) after a security-definer function, run as the acting user, has authorised the notification.
- **Realtime** only tells clients that *something changed* (Broadcast on a private per-user channel, sent by database triggers, with no event data in it). The client then re-fetches through the redacting functions. Clients never subscribe to raw row changes on other users' tables, because that would bypass redaction.

**Why there's no worker (D46):** the WF-024 spike ([write-up](docs/spikes/WF-024-vercel-vs-worker.md)) showed that a Node function can turn every allowed upload into vision-ready JPEGs without custom binaries: PDFium and libheif compiled to WASM, plus `sharp` for resizing, in about 0.02–3.3 s per file and under 1 GB of memory. Parse jobs live in Postgres (`parseJobs` with a lease and an attempt counter). A dedicated internal route runs one LLM attempt per invocation, and a cron sweep retries failures and recovers expired leases. `dispatch(jobId)` is the single seam, so a queue product or a worker could be added later without touching the rest.

**Why OpenRouter (D15):** one API and one key give access to many vision models. That makes comparing models on the eval set cheap, allows **fallback models** for reliability, and means switching models later doesn't change any code. We need models that accept **image input** and support **structured (JSON-schema) output**. When structured output isn't supported, validate the result with zod and retry.

### 8.2 Monorepo layout

```
whosfree/
├── apps/
│   └── web/                # Next.js (App Router) PWA + landing/auth/legal pages → Vercel
├── packages/
│   ├── backend/            # Supabase: supabase/migrations (schema, RLS, SQL functions), config.toml,
│   │                       #   generated DB types, typed client helpers, SQL tests
│   ├── availability/       # Pure TS availability engine (no I/O) + tests
│   ├── parser/             # Schedule extraction: prompts, output schema, OpenRouter client,
│   │                       #   file conversion (Node-only), post-processing, eval harness
│   ├── shared/             # zod schemas, types, constants (statuses, tiers, permissions, templates)
│   ├── ui/                 # Shared React components (Tailwind + shadcn/ui)
│   └── config/             # tsconfig, eslint, prettier presets
├── evals/schedules/        # Anonymised sample schedules + expected JSON (kept out of git if sensitive)
├── turbo.json
├── pnpm-workspace.yaml
└── PRD.md
```

### 8.3 Route map (apps/web)
| Area | Routes | Access |
|---|---|---|
| Public | `/` (landing), `/sign-in`, `/sign-up`, `/i/[code]` (invite), `/privacy`, `/terms`, `/help` | Anyone |
| Onboarding | `/onboarding/*` (hours, upload, review, Google Calendar, visibility, install) | Signed in |
| App | `/now`, `/schedule`, `/import`, `/import/[jobId]/review`, `/uploads`, `/friends`, `/friends/[id]`, `/groups`, `/groups/[id]`, `/groups/[id]/settings`, `/find-a-time`, `/inbox`, `/settings/*` | Signed in, 18+ confirmed |
| Admin | `/admin/*` | Internal role only |

### 8.4 Recommended tooling
| Concern | Choice | Notes |
|---|---|---|
| Monorepo | **Turborepo + pnpm workspaces** | |
| Backend | **Supabase** (decided, D40): Postgres, RLS, Storage, Realtime, Cron | Schema changes are SQL migrations managed with the Supabase CLI. TypeScript types are generated from the schema (`supabase gen types`). |
| Web | **Next.js (App Router), React, Tailwind, shadcn/ui** | Client components for real-time screens. The landing and legal pages are static or server-rendered. |
| Auth | **Clerk** (decided, D19), with Google or email-and-password sign-in (D45), connected to Supabase through **third-party auth** (Supabase validates Clerk session tokens) | Google Calendar uses a **separate OAuth flow that we own** (D30), not Clerk's tokens. |
| Google OAuth | **`google-auth-library`** / **`googleapis`**, running on the Next.js server | Handles code exchange, token refresh and revocation. The callback route lives in `apps/web`. |
| PWA | **Serwist** (successor to `next-pwa`) | Service worker, precaching, offline fallback. |
| Push | **Web Push with VAPID** (the `web-push` package on the Next.js server) | One subscription stored per device. |
| Recurrence | **In-house expander** in `packages/availability` (D42) | Recurring schedules stored as RRULE + EXDATE. Supports FREQ=DAILY/WEEKLY with INTERVAL, BYDAY, COUNT, UNTIL and WKST, and rejects anything else. |
| Dates | **Platform `Intl`** for timezone conversion in the engine (D42); the web app may use `date-fns` for display | UTC internally. A time skipped by DST moves later, and a repeated time means the first one (Temporal's default). |
| Validation | **zod** in shared code and at every route handler and server action | Postgres constraints (`CHECK`, foreign keys, enums) back it up in the database. |
| AI parsing | **OpenRouter** (decided, D15) with a vision model and structured output. The model is chosen from Phase 1 eval results. | Fallback models and no-data-retention provider routing (NFR-SEC-8). |
| Testing | **Vitest** (unit), **Playwright** (E2E), and database tests (migrations, RLS, SQL functions) run in Vitest against **PGlite** (in-process Postgres with a small Supabase auth shim) | |
| CI/CD | **GitHub Actions** for lint, typecheck, tests and parser evals. Vercel preview deploys. | |
| Rate limiting | **A Postgres counter table** checked inside the write functions | Fixed-window counters per user and action (NFR-SEC-9). |
| Observability | **Sentry**, **PostHog** | NFR-OPS-4 |

### 8.5 Key flows

**Schedule parse (FR-IMP)**
1. The client compresses the image or validates the PDF, then asks the server for a signed upload URL and uploads the file to a **private Supabase Storage bucket**. A `scheduleFiles` row is created with `deleteAt = uploadedAt + 7 days` (the fallback for files that are never confirmed).
2. The `create_parse_job` function saves a `queued` job, and the Next.js server dispatches it.
3. An internal route on the Next.js server (authenticated with `CRON_SECRET`, NFR-SEC-5) claims the job with a lease, downloads the file from Storage with the service role, checks its magic bytes and converts it in memory to at most 5 JPEGs (never stored, D38). A cron sweep re-dispatches jobs left in `queued` or whose lease expired (NFR-REL-4).
4. The server calls **OpenRouter** once per invocation with the prompt, the images and the JSON schema. It validates the response with zod, normalises it (times, days, week patterns, dates), scrubs anything location-like (D35) and scores confidence. A failure goes back to the queue with backoff, or to `failed` after 3 attempts.
5. The server saves the draft, which sets the job to `needs_review` (D46).
6. A Realtime signal tells the client the draft is ready, and it opens the review screen, where the user edits and confirms.
7. The `commit_schedule` function writes the events and, in the same transaction, **deletes the draft and the file's row** (D38). The server then removes the object from Storage straight away. (Storage objects can't be removed inside a SQL transaction, so the expiry cron retries any removal that fails.)
8. A daily cron deletes any unconfirmed files past their `deleteAt` date (FR-ADM-4).

**Google Calendar sync (FR-GCAL)**
1. The user taps Connect and goes through **our own** incremental OAuth flow (`calendar.readonly`, D30), with a `state` parameter tied to the Clerk session. A Next.js route handler receives the callback, exchanges the code for tokens, encrypts the refresh token and stores it (NFR-SEC-3).
2. The server runs the initial sync over the date window with `singleEvents=true`, upserts the events and stores the `syncToken`.
3. The server registers an `events.watch` channel that points at a webhook route on the Next.js server.
4. Each webhook triggers an incremental sync. Supabase Cron jobs (calling protected server routes) renew channels before they expire and run the polling fallback.
5. On disconnect, the token is revoked and every event from that source is deleted.

**Now screen (FR-VIEW)**
1. The client loads the Now data from the server and subscribes to its private Realtime channel.
2. The server, acting as the viewer, calls the `now_for_viewer` database function. It returns the viewer's connections, each with its resolved tier and, already redacted (FR-VIS-3, FR-VIS-5), today's events, any active override and their available hours. The server runs `availability.statusAt(now)` over that data and returns the result.
3. When a connection's events, override, tier or sharing state changes, a database trigger sends a Broadcast signal to the affected viewers' channels, and their clients re-fetch.
4. A small timer on the client re-evaluates the "until X" boundaries, so the client doesn't need to poll the server every minute.

**Joining a group (FR-SOC, FR-VIS-1)**
1. The invite page resolves the code and shows the group summary.
2. After sign-in and onboarding, the tier picker appears with T1 preselected.
3. The `join_group` database function checks the invite (not expired, not revoked, uses left), checks the group has fewer than 20 members, then creates the `groupMembers` row with the default permissions (`invite`, `groupPing`, D26) and a `visibilityRules` row for the chosen tier, all in one transaction.

---

## 9. Data model (draft)

These are Postgres tables in Supabase. Every table has an `id` (uuid) primary key and a `createdAt` timestamp. Times are `timestamptz`, stored in UTC, unless noted otherwise. Field names are written in camelCase here; the SQL columns use snake_case. **Row-level security is enabled on every table** (NFR-SEC-2).

| Table | Key fields | Notes / indexes |
|---|---|---|
| `users` | `clerkId`, `name`, `handle`, `avatarUrl`, `timezone`, `sharingPaused`, `birthYear`, `ageConfirmedAt`, `consentVersion`, `consentAt` | Indexes: `clerkId`, `handle`. The full date of birth is never stored (D29). |
| `availabilityPrefs` | `userId`, `weekly: {day, start, end}[]` (local time, default 08:00–22:00 every day, D24), `minGapMinutes`, `countAllDayEvents` | One row per user |
| `statusOverrides` | `userId`, `status` (`free`/`busy`/`dnd`/`away`/`focused`), `label?`, `startsAt`, `endsAt?` | Index: `userId, startsAt` |
| `friendships` | `userA`, `userB` (sorted), `status` (`pending`/`accepted`), `requestedBy` | Unique `userA, userB`; index `userB`. Blocks are in `blocks`, not here (D43). |
| `blocks` | `blockerId`, `blockedId` | Unique `blockerId, blockedId`. Directed, and readable by the blocker only, so the blocked person is never told (FR-SOC-6). A block in either direction removes all visibility. |
| `groups` | `name`, `emoji`, `adminId`, `maxMembers` (default 20), `joinMode` (`open`/`approval`) | |
| `groupMembers` | `groupId`, `userId`, `role` (`admin`/`member`), permissions as `canInvite`, `canManageMembers`, `canEditGroup`, `canGroupPing` (default `true, false, false, true`, D26), `joinedAt` | Unique `groupId, userId`; index `userId`. Exactly one `admin` per group. |
| `invites` | `code`, `groupId?`, `inviterId`, `expiresAt?`, `maxUses?`, `uses`, `revoked` | Index: `code` |
| `visibilityRules` | `ownerId`, `targetType` (`friend`/`group`), `targetId`, `tier` (1–3) | Index: `ownerId, targetType, targetId`. Created when a user joins a group or accepts a friend. |
| `offlineFriends` | `ownerId`, `nickname` (1–40 chars), `emoji?`, `permissionConfirmedAt` | Index: `ownerId`. Owner-only under RLS, never readable by anyone else (FR-SOC-15). Deleting one cascades to its sources and events. At most 20 per owner (FR-SOC-18). |
| `sources` | `userId`, `offlineFriendId?`, `type` (`upload`/`manual`/`gcal`), `status` (`healthy`/`failed`/`needs_reconnect`), `lastSyncedAt`, `gcal?: {calendarIds, syncTokens, channels}`, `periodStart?`, `periodEnd?`, `periodExceptions` | Index: `userId`. `offlineFriendId` set means the schedule belongs to that offline friend, not to the user (D44). `status`, `lastSyncedAt` and `periodEnd` drive the stale-data warning (FR-VIEW-8). Clients can read their own sources, so the encrypted Google refresh token goes in a separate table clients can't read (NFR-SEC-3). |
| `scheduleFiles` | `userId`, `storageId`, `mimeType`, `sha256`, `pages`, `uploadedAt`, `deleteAt` (= uploadedAt + 7 days), `deletedAt?` | Indexes: `userId`, `deleteAt` (used by the expiry cron). The row is removed along with the file on confirm (D38). |
| `parseJobs` | `userId`, `fileId`, `status` (`queued`/`processing`/`needs_review`/`committed`/`failed`), `draft?`, `confidence?`, `error?`, `parserVersion`, `model`, `attempts`, `costUsd?` | Indexes: `userId`, `status` |
| `events` | `userId`, `offlineFriendId?`, `sourceId`, `title`, `category` (`class`/`lab`/`tutorial`/`work`/`meeting`/`event`/`other`), `startsAt`, `endsAt`, `rrule?`, `exdates?` (start instants of cancelled occurrences), `isPrivate`, `externalId?`, `busy` | Indexes: `userId, startsAt` and `sourceId, externalId`. The RRULE must not run past its source's `periodEnd`. Events with `offlineFriendId` set are **never** part of the user's own availability and never returned to other viewers (D44). Past events are purged after 90 days (D32). **No location field** (D35). For Google events, `title` is set only while a T3 grant exists (D36). |
| `pings` | `fromId`, `toId`, `groupId?`, `template?`, `text?` (≤ 140 chars, plain text), `reply?`, `replyText?`, `expiresAt`, `readAt?` | Index: `toId, createdAt`. Purged after 30 days (D32). |
| `mutes` | `userId`, `targetType`, `targetId`, `until?` | |
| `pushSubscriptions` | `userId`, `endpoint` (unique), `p256dh`, `auth`, `deviceLabel?` (coarse, e.g. "Chrome on Android", not the user agent), `updatedAt`, `lastUsedAt` | Index: `userId`. At most 10 per user (least recently used dropped) |
| `reports` | `reporterId`, `targetType` (`user`/`group`/`ping`), `targetId`, `reason`, `status` | |
| `rateLimits` | `userId`, `action`, `windowStart`, `count` | Primary key: `userId, action, windowStart`. Used by the write functions (NFR-SEC-9). |

**Access rules (D41):** users read and write their own rows directly, under RLS. Other users' rows (events, overrides, available hours) are never selectable directly. They're returned only by `security definer` functions that check the connection, call `resolve_tier`, and `redact`. `users.clerkId` holds the Clerk user ID from the token; the `current_user_id()` SQL helper maps it to `users.id`.

**Modelling decision (recommended):** store recurring schedules as **one row with an RRULE** and expand them when read. This is compact and makes replacing a schedule easy. Store dated schedules and Google Calendar events as **one row per event**, since Google already expands recurrences for us.

---

## 10. Success metrics

Targets are **[ASSUMPTION]** placeholders for the closed beta and should be revisited once there's real data.

| Metric | Definition | Beta target |
|---|---|---|
| **Activation rate** | % of sign-ups who confirm a schedule **and** have at least 1 connection within 48 hours | ≥ 50% |
| **Parse acceptance** | % of parses confirmed with ≤ 3 edits | ≥ 70% |
| **Time to schedule** | Median time from upload to confirmation | ≤ 3 min |
| **Invite conversion** | % of invite-link opens that end in a sign-up | ≥ 30% |
| **K-factor** | Invites accepted per activated user | ≥ 1.0 within the seed community |
| **WAU / MAU** | Stickiness | ≥ 40% |
| **Pings per WAU** | Pings sent per weekly active user per week | ≥ 3 |
| **Slot finder use** | % of WAU who run the slot finder at least once a week | ≥ 15% |
| **D7 / D30 retention** | Share of new users still active after 7 and 30 days | ≥ 40% / ≥ 25% |

**North-star metric:** *weekly "link-ups enabled"*, counted as pings answered "I'm down" plus slot-finder slots that were shared.

---

## 11. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Parsing is inaccurate**, made worse now that the parser has to handle any kind of schedule (D7, D11). | High | High | Review is mandatory (FR-IMP-9). Low-confidence events are highlighted. Manual entry is always available. A diverse eval set runs in CI (NFR-OPS-3). OpenRouter makes it cheap to try other models. Shared templates come later (FR-IMP-21). |
| R2 | **Cold start**: the app is useless until your friends are on it. | High | High | Growth through invites (FR-SOC-3, FR-SOC-4). Onboarding starts from the invite. Launch in **one tight seed community** first (§13). The app is still useful alone (My schedule, own status). |
| R3 | **Google OAuth verification is slow or rejected**, and the 100-user cap blocks growth. | Medium | High | Apply early (Phase 0–1). Google Calendar is optional in onboarding, and the upload path works without it. Keep a free/busy-only scope ready as a fallback. Fix the final name before applying (D23). |
| R4 | **Privacy misuse**, such as stalking or controlling behaviour. | Medium | High | T1 is the default, locations are never stored (D35), users can block, pause sharing and see who can see them, reporting exists, and friend requests need both sides. Admins get no extra visibility (FR-SOC-10). |
| R5 | **iOS PWA limits**: push notifications only work once installed, and storage can be cleared. | High | Medium | Install guide (FR-PWA-3). In-app inbox as a fallback (NFR-COMPAT-2). Measure the iOS share during the beta. |
| R6 | **AI costs run away** through abuse or large files. | Medium | Medium | Rate limits, page and size limits, resizing, caching by file hash, cost recorded per job (`parseJobs.costUsd`), and price comparison across models on OpenRouter. |
| R7 | **Stale data** makes people look free when they aren't. | Medium | Medium | Sync-health indicators (FR-GCAL-10) and the stale-data warning (FR-VIEW-8, D25). Reminders when a schedule is about to end (J6). |
| R8 | **Complexity of several server pieces** (Supabase + Next.js server). | Low | Low | Mitigated by D46: there is no separate worker. Parse runs sit behind one `dispatch` seam (§8.1). |
| R9 | **Regulatory**: DPA registration and sending data abroad. | Low | High | Get legal advice before public launch (NFR-COMP). |
| R10 | **Ping fatigue or abuse through free text** leads to muting or harassment. | Medium | Medium | Rate limits, quiet hours, DND, pings that expire, one-tap report and block (FR-PING-8), plain-text rendering. |
| R11 | **Google accounts managed by a school or employer** block third-party apps from reading calendars. | Medium | Medium | Detect the specific OAuth error and explain it clearly. The upload path still works. Suggest connecting a personal Google account. |
| R12 | **Uploaded files contain extra personal data** (ID numbers, photos, full names) (D38). | Low | Medium | Files are deleted on confirm (or after 7 days), the parser never extracts those fields (D35), storage is private and only the owner and the server can access it, and the privacy notice tells users they can crop before uploading. |
| R14 | **Accidental sensitive data** in Google event titles (health, religion) and in schedule titles. | Medium | High | Google titles are stored only while a T3 grant exists (D36). Google descriptions, attendees and locations are never stored. Private events. Titles are never logged or sent to analytics. |
| R13 | **A broader audience (D11) blurs the focus** of the MVP. | Medium | Medium | Keep the product general, but **launch in one dense seed community** where schedules are structured and coordination is frequent. |
| R14 | **Offline friends are misused** to track someone who never agreed (D44). | Medium | High | Nickname only, no locations anywhere (D35), a permission confirmation, a clear terms clause, visible only to the uploader, a cap of 20, report and account action under the terms, and a legal review of the basis for holding non-users' data (NFR-COMP-9). |

---

## 12. Out of scope & future ideas

### Planned after the MVP
- **.ics import and subscription URLs**, covering Outlook, Apple Calendar and any portal that exports ICS. This is likely the **most reliable source**, so it should be the first thing added after the MVP.
- **Microsoft Outlook / Microsoft 365** sign-in and sync, because many schools and workplaces run on Microsoft.
- **Shared schedule templates** (FR-IMP-21).
- **Slot polls** and **calendar invites** from the slot finder (FR-SLOT-6, FR-SLOT-7).
- **Join-approval groups** (FR-SOC-13).
- **Monetisation** exploration (D16). Possible directions: premium features (bigger groups, more slot-finder range) or a tier for organisations such as clubs. Never selling data.

### Ideas to explore (not committed)
- **"I'm at…" broadcasts**: an opt-in message like "At the library till 4, pull up" sent to chosen friends. This deliberately shares a location, so it must be opt-in every time and expire.
- **Suggestions from shared schedules**: "3 people in your groups also have COMP2140." Opt-in, because it reveals what someone is enrolled in.
- A **home-screen widget or badge** showing how many friends are free now (depends on platform support).
- An **events layer**: local and community events matched to everyone's free time.
- **Integrations with institutions** (NG4).
- **Native apps** with Expo, reusing the shared packages, if PWA limits start to hurt retention.

### Won't do (for now)
- Live GPS location sharing (NG1).
- Full chat (NG3).
- Calendar editing (NG2).

---

## 13. Roadmap & next steps

No fixed dates (D10). Each phase ends when its exit criteria are met.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0: Foundations** | Monorepo scaffold (Turborepo, pnpm), Next.js app, Supabase project, Clerk auth with the age check, CI, Sentry and PostHog, environments. **Landing and legal pages** (FR-WEB-1, FR-WEB-4). **Start preparing Google OAuth verification.** | A signed-in 18+ user sees an empty Now screen on a preview deploy. The landing page is live. CI is green. |
| **1: Import spike, then build** | Collect samples, build the eval harness, **compare 2–3 vision models through OpenRouter**, decide whether the worker is needed (decided: it isn't, D46). Then build upload → parse → review → commit, manual entry, My uploads, and file expiry. | **≥ 70% parse acceptance** on the eval set. The whole flow works on a phone. |
| **2: Social & visibility** | Friends, groups (admin, permissions, 20-member cap), invite pages and links, WhatsApp sharing, blocking, choosing a tier at join, "Who can see me", server-side redaction. | Two test users in a group see each other at the tier each chose, permissions are enforced, and tests prove the redaction works. |
| **3: Availability & Now** | `packages/availability`, available hours, manual status, the Now screen with "until X", friend detail, real-time updates. | Engine coverage ≥ 90%. The Now screen updates within 5 s. |
| **4: Google Calendar** | Incremental OAuth, sync, webhooks and polling, private events, disconnect and delete. | A Google Calendar change appears in whosfree within 5 minutes (15 in the worst case). |
| **5: Ping & slot finder** | Web Push, templates plus free text, replies, rate limits, mute and quiet hours, reporting, the slot finder, sharing a slot. | A ping and its reply complete in under 10 s on Android. Slot-finder tests pass for 20 people. |
| **6: PWA polish & closed beta** | Install flow, offline mode, iOS guide, accessibility pass, final privacy notice and terms, DPA registration, **launch to one friend circle, then one seed community** of 30–100 users. | The §10 metrics are being collected and beta feedback is in. |
| **7: Iterate** | Fix the biggest problems from the beta, then .ics import and shared templates. | A decision on what comes next. |

### 13.1 MVP milestones (D34)
The phases above describe *what gets built*. The milestones below describe *when people can start using it*. The MVP is every **Must** requirement, which is every P0 issue in [ISSUES.md](ISSUES.md) (74), and it's delivered in three steps: **A → Gate → B**. A + Gate = public launch.

| Milestone | Scope | Audience | Exit criteria |
|---|---|---|---|
| **A: Core loop** (41 issues) | Sign-up with the age check. Upload → parse → review → commit, plus manual entry. **Friends** (requests with a tier choice, block/remove). **Offline friends** (upload a friend's timetable, D44). Groups and invite links. Visibility tiers with server-side redaction. The availability engine, available hours, manual status, the Now screen and onboarding. PWA install, Web Push, pings and replies. A draft privacy notice and consent record. | Small trusted group of friends. There's no Google user cap here, because Milestone A has no calendar scope. | People can upload, add each other as friends or join a group, see each other at the tier they chose, and ping each other on Android and on installed iOS. |
| **Gate: Public-ready** (7 issues) | Milestone A plus parse rate limits, group member management, ping limits and mute, report and block, the Jamaica DPA legal work, the security review, and a manual process for export and deletion requests. | **The public** | Every gate issue is `done`. See D39. |
| **B: MVP complete** (26 issues) | Google Calendar (connect, sync, disconnect, verification). Slot finder. "Who can see me". Retention jobs. Self-serve data export and account deletion. Minimal Google titles (WF-125). Offline mode, accessibility, performance. | Closed beta: 30–100 users in a seed community | WF-121 has shipped and the §10 metrics are being tracked. |

Should-have requirements (P1) are **stretch** work. They can be picked up in either milestone once their dependencies are done, but they're never required.

> ⚠️ Milestone A leaves out safety and compliance features, so it's only for a small, trusted test group. **Nothing is opened to the public until the public-ready gate is passed** (D39). The rest of Milestone B (Google Calendar, slot finder, offline mode, polish) can ship after the public launch.

**Public-ready gate (D39).** These must be `done`, on top of Milestone A:

| Issue | Why it's needed before strangers can use the app |
|---|---|
| WF-035 Parse rate limiting | Stops one person draining the OpenRouter budget and breaking parsing for everyone |
| WF-044 Group member permissions | Lets admins remove strangers who joined through a forwarded invite link |
| WF-094 Ping rate limits, mute, quiet hours | Stops spam |
| WF-095 Report and block + moderation queue | Handles harassment through free-text pings |
| WF-119 Jamaica DPA legal review + OIC registration | A legal requirement for processing the public's personal data |
| WF-120 Security review | Tier redaction is the core promise. A leak here is the worst failure the app can have. |
| WF-126 Manual export/deletion process | Meets data-subject rights by email until WF-113 and WF-114 are built |

### Next steps
1. **Check the remaining [ASSUMPTION]s** (§14.1) against real data during Phase 1 and the beta, and update this PRD as they're confirmed or changed.
2. **Collect 20+ real schedules** covering university timetables, high-school timetables, **work rosters and shift schedules**, screenshots of portals and apps, and photos of printed sheets. Write the expected JSON for each one. This becomes the parser **eval set**, and it matters more than anything else in Phase 1.
3. **Decide the final name and register the domain** before submitting for Google verification (D23, NFR-COMP-6).
4. **Create the Google Cloud project**: set up the OAuth consent screen and add test users.
5. **Create the Clerk application** (dev and prod instances) and an **OpenRouter account**, setting the data-retention and provider preferences (NFR-SEC-8).
6. **Scaffold the monorepo** (Phase 0).
7. **Informal user research**: interview 5–10 people (students, shift workers, organisers) about how they coordinate today and how much they'd share.

---

## 14. Open questions

### 14.1 Open
**None right now.** New questions will be added here as they come up during the build.

The **[ASSUMPTION]** markers still in this document (for example the file-size and page limits, rate limits, performance budgets, scale targets and beta metric targets) aren't open questions. They're working values to check against real data in Phase 1 and the beta.

### 14.2 Resolved (v0.3)
| # | Question | Answer | Decision |
|---|---|---|---|
| OQ7 | Default available hours? | A "When are you usually up and about?" slider during onboarding, **pre-set to 08:00–22:00 every day** and editable per day | D24 |
| OQ11 | How do we show that data may be stale? | **Option (b)**: no timestamp while healthy, and a ⚠️ only when a source has failed, not synced in over 24 hours, or passed its end date | D25 |
| OQ16 | Default permissions for new group members? | **invite ✓, groupPing ✓, manageMembers ✗, editGroup ✗** | D26 |
| OQ17 | Overlapping group tiers? | **The most restrictive group tier applies.** A tier set for an individual friend overrides it. Show a hint explaining why. | D27 |
| OQ18 | Dated schedules in the MVP? | **Yes, as a Should**, built after recurring schedules in Phase 1 | D28 |
| OQ19 | Age check method? | A **self-declared date of birth**. Store only the birth year and a timestamp. | D29 |
| OQ20 | Google Calendar tokens? | **Our own OAuth flow**, separate from Clerk | D30 |
| OQ21 | Limits on ping text? | **140 characters**, plain text, links not clickable, no automatic filter, report and block available | D31 |
| OQ22 | Retention for other data? | Past events **90 days**, pings **30 days** | D32 |
| OQ23 | Does re-parsing reset the 6-month file clock? | **No.** It's always counted from upload. *Made moot by D38.* | D33 |

### 14.3 Resolved (v0.2)
| # | Question | Answer | Decision |
|---|---|---|---|
| OQ1 | Should raw files be kept after the user confirms? | Yes, for **up to 6 months**. Users can re-upload at any time. *Reversed in v0.5: files are deleted on confirm.* | D12 → D38 |
| OQ2 | Minimum age? | **18** | D13 |
| OQ3 | Free text in pings? | **Yes** | D14 |
| OQ4 | AI provider? | **OpenRouter** | D15 |
| OQ5 | Monetisation? | Not decided. Revisit later. | D16 |
| OQ6 | Group roles and limits? | **One admin plus per-member permissions**, max **20** members | D17 |
| OQ8 | "Free until X" or just "Free"? | **"Free until X"** | D18 |
| OQ9 | Clerk or Convex Auth? | **Clerk** (still Clerk after the move to Supabase, D40) | D19 |
| OQ10 | Visibility across groups? | The user **chooses a tier before joining** each group, with **T1 as the default**. (The overlap question continues as OQ17.) | D20 |
| OQ12 | Web presence? | **Landing page, auth pages and so on** | D21 |
| OQ13 | Workspace domains at universities? | **Not limited to universities.** Replaced by the general risk R11. | D11 |
| OQ14 | What do users with no schedule show as? | **"Hasn't added a schedule yet"** instead of "unknown" | D22 |
| OQ15 | Is "whosfree" final? | **No**, it's a working name | D23 |

---

## 15. Decision log

| # | Date | Decision | Why |
|---|---|---|---|
| D1 | 2026-09-30 | **Tiered visibility per viewer.** The default is T1 (Free/Busy with times). T2 (Category) and T3 (Details) can be granted to each friend or group. Location is never shared. | Showing class and event names to everyone is a safety risk and would put people off signing up. |
| D2 | 2026-09-30 | **Social model: friends plus groups.** Friend requests need both sides to accept. Groups are joined by invite link. | Covers close friends as well as looser groups, and invite links drive growth. |
| D3 | 2026-09-30 | **MVP sources: PDF/image upload with AI parsing, plus Google Calendar.** .ics and Outlook come after the MVP. | Parsing uploads is the core idea. ICS is noted as a reliable next source. |
| D4 | 2026-09-30 | **Core actions: view, one-tap ping, group slot finder.** | A dashboard you can only look at doesn't keep people coming back. |
| D5 | 2026-09-30 | **"Free" means inside available hours, with no busy event and no overriding manual status.** | A gap in a schedule isn't the same as being free (sleep, travel, work). |
| D6 | 2026-09-30 | **Stack: Turborepo monorepo. Next.js on Vercel. ~~Convex~~ Supabase (D40) as the main backend. ~~A Railway worker for heavy jobs only~~ (dropped, D46).** | Your preference. |
| D7 | 2026-09-30 | **The parser is generic from day one, and review is mandatory.** | Users bring many different formats, and review makes up for imperfect accuracy. |
| D8 | 2026-09-30 | **Google Calendar uses the full-events scope (`calendar.readonly`). Events show as Busy by default. Start verification early.** | T2 and T3 need event details, and verification takes a long time. |
| D9 | 2026-09-30 | **Main jurisdiction is Jamaica** (Data Protection Act 2020). | That's the launch market. |
| D10 | 2026-09-30 | **No fixed deadline.** Phases are ordered by priority. | It's a side project, so quality comes before speed. |
| D11 | 2026-09-30 | **The audience isn't limited to universities.** Anyone 18+ with a schedule can use it. Students are one example. | Your call. The product is general, and the go-to-market still starts with one seed community (R13). |
| D12 | 2026-09-30 | ~~**Raw schedule files are kept for up to 6 months from upload.**~~ **Superseded by D38.** Users can delete them or re-upload at any time. | Allows re-parsing, comparison during review and debugging, with a limit on retention. |
| D13 | 2026-09-30 | **Minimum age is 18.** | Avoids the extra consent and safety work that minors would need. |
| D14 | 2026-09-30 | **Pings can include free text** as well as templates. | More useful. The abuse risk is handled by rate limits, reporting and blocking. |
| D15 | 2026-09-30 | **AI calls go through OpenRouter.** | One API to many models, easy comparison on the eval set, fallback models. |
| D16 | 2026-09-30 | **No monetisation in the MVP. Never sell user data.** | Focus on product–market fit first. |
| D17 | 2026-09-30 | **Groups have one admin. The admin grants each member permissions (invite, manage members, edit group, group ping). Max 20 members.** | Enough structure for clubs and teams while keeping groups small and manageable. |
| D18 | 2026-09-30 | **Viewers see "free until X" and "busy until X".** | The "until" time is the most useful part and reveals only a time. |
| D19 | 2026-09-30 | **Auth uses Clerk.** Since D40 it connects to Supabase through third-party auth. | Quick to build with, well-made Google sign-in, and an official integration with the backend. |
| D20 | 2026-09-30 | **Users choose their visibility tier for each group before joining** (and for each friend when accepting). **T1 is the default and the minimum.** | You control your privacy before you join, and every group gets a useful baseline. |
| D21 | 2026-09-30 | **Public web pages: landing, sign-in/sign-up, invite pages, legal pages, help.** | Needed to acquire users, handle invites and pass Google verification. |
| D22 | 2026-09-30 | **Users without a schedule show "Hasn't added a schedule yet". Users who paused sharing show "Sharing paused".** These replace the generic "unknown" status. | Clearer for viewers, and it gives an obvious "nudge them" action. |
| D23 | 2026-09-30 | **"whosfree" is a working name.** | Decide the final name before submitting for Google verification, because rebranding afterwards may trigger a new review. |
| D24 | 2026-09-30 | **Default available hours come from an onboarding question, "When are you usually up and about?", with a slider pre-set to 08:00–22:00 every day. Users can edit each day later.** | Most people never change defaults, so the default should be sensible, and asking once makes people think about it. |
| D25 | 2026-09-30 | **Stale data is flagged only when it matters.** A ⚠️ "Schedule may be out of date" appears when a source has failed, hasn't synced in over 24 hours, or has passed its end date. No timestamps while things are healthy. | Keeps the Now screen clean while still warning about wrong statuses. |
| D26 | 2026-09-30 | **New group members get `invite` and `groupPing` by default. `manageMembers` and `editGroup` are held back.** | Invites help growth, and control over the group stays with the admin. |
| D27 | 2026-09-30 | **When tiers overlap, the most restrictive group tier applies. A tier set for an individual friend overrides it. A hint explains why.** | Privacy is the safe default, and the hint prevents confusion. |
| D28 | 2026-09-30 | **Dated schedules (rosters) are a Should, built after recurring schedules in Phase 1 if the eval set shows it's workable.** | Shift workers matter now that the audience is broader (D11), but recurring timetables come first. |
| D29 | 2026-09-30 | **The age check is a self-declared date of birth. Only the birth year and a confirmation timestamp are stored.** | Proportionate and low-friction, and it keeps collected data to a minimum. ID checks are too heavy for the MVP. |
| D30 | 2026-09-30 | **Google Calendar uses our own OAuth flow, separate from Clerk. Refresh tokens are encrypted and stored in our database** (Supabase since D40). | Keeps sign-in and calendar access independent, and background sync doesn't depend on Clerk's API. |
| D31 | 2026-09-30 | **Free-text pings: 140 characters at most, plain text only, links not clickable, no automatic filter in the MVP, report and block available.** | Useful without becoming a chat app, with enough protection against abuse. |
| D32 | 2026-09-30 | **Retention: past events 90 days, pings 30 days.** | Enough history to be useful without keeping more personal data than needed. |
| D33 | 2026-09-30 | ~~**The 6-month file clock always counts from upload and never resets. Re-uploading creates a new file.**~~ **Superseded by D38.** | A predictable, honest limit that's easy to explain in the privacy notice. |
| D34 | 2026-09-30 | **The MVP is delivered in two milestones. Milestone A is the core loop (upload, friends, groups, Now, pings) for a small trusted test group. Milestone B completes the MVP (Google Calendar, slot finder, safety, compliance, polish) and ends with the closed beta.** Friends are part of Milestone A. | Gets real use and parser feedback early without cutting any MVP scope. Friends are central to "who's free", and the Now screen depends on them. |
| D35 | 2026-09-30 | **Event locations are never stored.** The parser ignores rooms, addresses, ID numbers and other personal details in files. | Knowing where someone will be is the biggest safety risk, and the app doesn't need it. |
| D36 | 2026-09-30 | **Minimal Google Calendar data.** Store only start/end, busy, the private flag and the event ID. The title is stored only while the owner has given someone the T3 tier. Never store descriptions, attendees, locations or links. | Removes most accidental sensitive data and data about non-users. Supports Limited Use. |
| D37 | 2026-09-30 | **No IP addresses in PostHog or Sentry.** | We don't need them, so we shouldn't collect them. |
| D38 | 2026-09-30 | **Raw files are deleted when the schedule is confirmed**, or 7 days after upload if it never is. **Replaces D12 and D33.** Re-parsing confirmed files (FR-IMP-18) is dropped. | Files often contain ID numbers, photos and full names we don't need. Keeping them was the biggest avoidable privacy risk. |
| D39 | 2026-09-30 | **Public-ready gate**: public launch needs Milestone A plus WF-035, 044, 094, 095, 119, 120 and 126. Export and deletion requests are handled by email until WF-113 and WF-114 exist. The rest of Milestone B ships after launch. Also corrects the earlier claim that Milestone A was capped at 100 users by Google. That cap only applies to the calendar scope, which A doesn't use. | Replaces "nothing public before Milestone B", which set the bar higher than needed. The gate covers the real legal, safety and cost risks. |
| D40 | 2026-09-30 | **The backend is Supabase instead of Convex**: Postgres with row-level security, Storage, Realtime and Cron. **Clerk stays** for sign-in, connected through Supabase third-party auth. Replaces the Convex part of D6. | Owner's preference. The data is relational, RLS enforces authorisation in the database, and Postgres is portable. |
| D41 | 2026-09-30 | **Authorisation and tier redaction are enforced in Postgres** (RLS plus `security definer` functions). TypeScript server logic (availability engine, Google sync, push, parse jobs) runs on the Next.js server on Vercel. Realtime sends only "something changed" signals, never other users' rows. | No client path can bypass redaction, and the shared TypeScript packages run unchanged in Node. |
| D42 | 2026-09-30 | **Recurrence and timezones are handled in-house** in the availability engine, not with `rrule` or `date-fns-tz`. Occurrences keep the first occurrence's local wall-clock times. Week numbers count from the Monday week containing the schedule's start date. | We only need a small RRULE subset, and `rrule`'s timezone handling is a common source of DST bugs. Doing it ourselves keeps the rules explicit and fully tested. |
| D43 | 2026-09-30 | **Blocks are a separate, directed table**, not a friendship status. | A shared friendship row would let the blocked person see the block. Two people can block each other independently, and blocks also apply between people who aren't friends. |
| D44 | 2026-09-30 | **Offline friends**: users can add people who aren't on whosfree and upload or type in their timetables. Private to the uploader, nickname only, with a permission confirmation, and never merged with a real account. Part of Milestone A. | The app has to be useful before someone's friends join (R2, cold start), and people already have their friends' timetables. |
| D45 | 2026-09-30 | **Sign-in accepts email and password as well as Google.** Clerk handles passwords, email verification and resets; we never see or store a password. Names are required at email sign-up. | Not everyone wants to use their Google account (A3, R11), and some school-managed Google accounts block third-party apps. Clerk supports both with no extra backend work. |
| D46 | 2026-09-30 | **No separate worker service.** PDF and HEIC conversion (PDFium and libheif as WASM, plus `sharp`) and the OpenRouter call run on the Next.js server in a dedicated internal route. Uploads go straight to Supabase Storage through signed upload URLs. Parse jobs are queued in Postgres with a lease and retried by a cron sweep. Replaces the worker part of D6. | The WF-024 spike showed conversion fits comfortably in a Node function (WASM, no custom binaries), so a second service, its HMAC channel and a second deploy target aren't worth it (R8). `dispatch(jobId)` keeps it swappable. |
| D47 | 2026-10-01 | **Every user has a handle, generated from their name at sign-up.** The database picks it when it creates the account (the name lowercased, accents dropped, letters and digits only, up to 20 characters, with a random number added if it's taken or reserved). Users can change it to any free handle but can't clear it. Existing accounts without one are given one. Replaces the optional handle in FR-AUTH-2. | Friends find each other by handle (FR-SOC-1), so an account without one can only be added by link or QR code. Generating it in Postgres keeps uniqueness and the reserved words in one place. |

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **Admin** | The one member of a group who holds every permission and can grant permissions to others (D17). |
| **Available hours** | The part of each day a user is willing to show as free. Outside it they appear as `away` (FR-AVL-2). |
| **Connection** | Any friend or fellow group member who can see you. |
| **Dated schedule** | A schedule of events on specific dates (e.g. a work roster), as opposed to one that repeats weekly. |
| **Draft** | What the parser produces before the user reviews and confirms it. |
| **Eval set** | Real sample schedules with hand-written expected output, used to measure parser accuracy. |
| **OpenRouter** | An API gateway that gives access to many AI models through one interface (D15). |
| **Override / manual status** | A status the user sets that takes priority over what their calendars say. |
| **Permission** | A group ability the admin grants to a member: `invite`, `manageMembers`, `editGroup`, `groupPing`. |
| **Ping** | A light nudge (template and/or short text) sent to a friend, e.g. "Free for food?". |
| **PWA** | Progressive Web App: a website you can install on your home screen that can send push notifications. |
| **Recurring schedule** | A schedule that repeats weekly within a date range (e.g. a semester timetable). |
| **Slot finder** | A tool that finds times when a set of people are all, or mostly, free. |
| **Stale data** | Schedule data we can't trust: a source that failed to sync, hasn't synced in over 24 hours, or has passed its end date. It's flagged with ⚠️ (D25). |
| **Source** | Where schedule data comes from: an uploaded file, manual entry, or Google Calendar. |
| **Tier (T1/T2/T3)** | How much detail a viewer sees about your busy time. T1 is the default and the minimum (D20). |
