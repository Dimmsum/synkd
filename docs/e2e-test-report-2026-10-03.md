# End-to-end test report: 2026-10-03

A run of [`e2e-test-plan.md`](e2e-test-plan.md) against `apps/web` on `localhost:3000` (dev server), the Supabase dev project and the Clerk development instance. Two main test users (A, B), plus a throwaway under-18 user (C) and a third user who joined through invites (D), each in their own headless Chromium profile. Desktop 1440×900, phone 390×844.

## Summary

| | |
|---|---|
| Cases run | 62 |
| Passed | 59 (some with notes below) |
| Failed | 3 (E2E-23, E2E-24, E2E-30) |
| Bugs filed | 5: [WF-132](../ISSUES.md#wf-132--status-chip-shows-the-previous-status-until-now-right-after-a-status-change) to [WF-136](../ISSUES.md#wf-136--polish-from-the-2026-10-03-e2e-run-plurals-copy-tap-targets-a11y) |
| Needs your decision | 1 (under-18 re-entry) |

The core loop works end to end:
- sign-up → age → terms → onboarding
- upload → parse → review → confirm (the parse was accurate and ignored rooms, the student ID and the name)
- friend requests by handle and by invite link
- tier redaction T1/T2/T3
- groups with permissions and admin transfer
- pings with replies
- offline friends, kept private from everyone else
- the phone drawer navigation

Every privacy check passed: no data above tier, offline friends never visible to others, blocked users get the same reply as for unknown handles, and the invite pages show only what they should.

## Bugs filed

| ID | Severity | What |
|---|---|---|
| [WF-133](../ISSUES.md#wf-133--realtime-join-is-sent-without-the-token-so-changes-in-the-first-7-s-after-a-page-load-are-lost) | S2 | The first Realtime `phx_join` on every page has no `access_token`. Realtime rejects it as Unauthorized after ~4 s (`CHANNEL_ERROR` in the console) and the retry joins at ~7 s. Changes in that window are lost for good, because the hook only catches up on a *re*-join. Confirmed from the WebSocket frames. Fails WF-064's "≤ 5 s". |
| [WF-134](../ISSUES.md#wf-134--unbuilt-screens-show-mock-people-and-placeholder-results-to-real-users) | S2 | Unbuilt screens are live and show wrong information: Find a time (mock people and slots), Who can see me (mock groups and friends), friend detail ("Not sharing yet" for a friend who is sharing), the group "next time everyone's free", and Nudge (says "Nudged" but sends nothing). |
| [WF-132](../ISSUES.md#wf-132--status-chip-shows-the-previous-status-until-now-right-after-a-status-change) | S3 | After setting or clearing a manual status, the chip shows the *previous* status "until <now>" until a reload. Likely a clock race between the app server's `Date.now()` and Postgres `now()`. |
| [WF-135](../ISSUES.md#wf-135--remove-friend-block-leave-make-admin-and-delete-group-happen-on-one-tap-with-no-confirmation) | S3 | Remove friend, Block, Leave group, Make admin and **Delete group** happen on one tap with no confirmation. Deleting an offline friend does confirm, which shows the pattern to copy. |
| [WF-136](../ISSUES.md#wf-136--polish-from-the-2026-10-03-e2e-run-plurals-copy-tap-targets-a11y) | S4 | Polish: "1 friends"/"1 members", "What New will see", "Your week" on an offline friend's review, no overnight marker, the review grid scrolls sideways on desktop, tap targets under 44 px, the handle field has no `aria-invalid`, rejected uploads kept for 7 days. |

## Needs your decision

**Under-18 re-entry (E2E-05).** Someone who enters a date of birth under 18 is signed out and sees the not-eligible page, as designed. But the account still exists, and signing in again shows the age form, where they can enter an older date. `confirmAge` deliberately records nothing (D29: the check is self-declared). PRD FR-AUTH-6 says accounts "found to be under 18 are suspended and then deleted". Whether a self-declared under-18 answer counts as "found" is your call. If it does, recording only "age check failed" (no date of birth) and blocking re-entry would stay within D29. No issue filed.

## Known gaps seen again (no new issue)

- **No unblock UI** anywhere. Already listed as open in WF-047 (`list_blocked_users`/`unblock_user` exist).
- **Email sign-up asks for no name**, so every user starts as "New member". This is WF-130's open owner item (Clerk dashboard setting). With three test users all called "New member", lists were hard to tell apart.
- **The service worker only registers in production builds** (`SerwistProvider disable` outside production), so E2E-61 could only check the manifest and that `/serwist/sw.js` is served.

## Not verified in this run

- **Database-level checks:** that only `birth_year` and `age_confirmed_at` are stored, the consent columns, the job reaching `committed` with its file row deleted, and the parse-attempt counter. Reading the database with the secret key was blocked by a permission rule during the run, so these were checked through the UI only.
- **Server-side enforcement** of group permissions and of pinging someone on Do not disturb, using crafted requests. Only the UI was checked: controls are hidden or disabled.
- Push delivery, notification-button replies, Google sign-in, Google Calendar, installing on a device (out of scope, see the plan).
- **Low-confidence highlighting** on the review grid: the clean test timetable produced no low-confidence events.

## Setup notes for next time

- **Clerk bot protection** (a Cloudflare Turnstile CAPTCHA) blocks automated sign-up. The run used Clerk's official testing tokens (`@clerk/testing`, with `CLERK_SECRET_KEY`), which you approved. `+clerk_test` emails with the code `424242` then work.
- **Node version:** the machine runs Node 20.19.5, but `.nvmrc` says 22. supabase-js warns that Node 20 support is deprecated.
- **The harness** (`.e2e/`, excluded from git through `.git/info/exclude`) holds one persistent Chromium profile per user and runs scripted steps. Ask if you want it turned into a committed Playwright suite.

## Results by case

| ID | Result | Notes |
|---|---|---|
| E2E-01 | Pass | `/now`, `/friends`, `/settings` → `/sign-in?redirect_url=…` |
| E2E-02 | Pass | Landing, privacy, terms, help, contact load signed out. Unknown paths go to sign-in when signed out (deny by default). |
| E2E-03 | Pass | Email + code → `/sign-up/age`. In dev, the Clerk card is blank for ~8 s between the code and the redirect. |
| E2E-04 | Pass | App routes and `/sign-up/terms` → `/sign-up/age` until age confirmed |
| E2E-05 | Pass | Turns 18 tomorrow → "You must be 18 or older", signed out. See *Needs your decision*. |
| E2E-06 | Pass* | Adult date of birth → terms. *Stored columns not checked. |
| E2E-07 | Pass | `/now` → terms; age step can't be revisited; "Agree" disabled until ticked |
| E2E-08 | Pass* | Accept → `/onboarding`. *Consent columns not checked. |
| E2E-09 | Pass | Generated handles `@newmember63`, `@newmember53` |
| E2E-10 | Pass | Browser closed and reopened: still signed in, onboarding resumed |
| E2E-11 | Pass | "When are you usually up and about?" 8:00 AM–10:00 PM every day |
| E2E-12 | Pass | Text file renamed `.png` → "That file isn't a PDF, photo or screenshot we can read" |
| E2E-13 | Pass | Uploading → Waiting in line → Reading → Ready to review in ~2–5 s |
| E2E-14 | Pass | 6 events with correct days, times and kinds; dates Sep 7–Dec 4 found; National Heroes Day prefilled; file shown beside the grid; no rooms, ID or name |
| E2E-15 | Pass | Edit, delete and add show in the draft. End before start = overnight by design (WF-136: no marker). |
| E2E-16 | Pass* | Schedule empty before confirm; confirm → install step. *Job and file row not checked in DB. |
| E2E-17 | Pass | → Now. My schedule week matches the confirmed draft exactly. |
| E2E-18 | Pass | Skip, skip, skip → Now; skipped steps reachable from Settings |
| E2E-19 | Pass | Manual entry: empty confirm refused ("Add at least one event first."), 2 events saved |
| E2E-20 | Pass | Name and photo saved, persist after reload |
| E2E-21 | Pass | Too short, bad characters, reserved, taken (case-insensitive) and empty are all refused (WF-136: no `aria-invalid`) |
| E2E-22 | Pass | `e2e_alice` saved |
| E2E-23 | **Fail** | Busy until 4 PM: right after "Set status" the chip shows "Free until 12:43 PM" ([WF-132](../ISSUES.md#wf-132--status-chip-shows-the-previous-status-until-now-right-after-a-status-change)). The note's `<b>` is shown as plain text. |
| E2E-24 | **Fail** | Back to automatic: the chip shows "Busy until 12:44 PM · note" until a reload ([WF-132](../ISSUES.md#wf-132--status-chip-shows-the-previous-status-until-now-right-after-a-status-change)) |
| E2E-25 | Pass | Hours saved per day; outside hours → "Away" |
| E2E-26 | Pass | Request by handle; T1 preselected; unknown handle and own handle handled |
| E2E-27 | Pass | Accept with tier picker; both see each other (WF-136: "1 friends") |
| E2E-28 | Pass | B under "Busy or away", "Busy until 2:00 PM", with a text label |
| E2E-29 | Pass | A sees B as "Busy" (T1) → "At work" (T2) → "Weekend shift" (T3) → back to "Busy" |
| E2E-30 | **Fail** | No live update when the change lands in the first ~7 s after a page load ([WF-133](../ISSUES.md#wf-133--realtime-join-is-sent-without-the-token-so-changes-in-the-first-7-s-after-a-page-load-are-lost)). Works after that (~2.5 s). |
| E2E-31 | Pass | Friend invite: signed-out page shows only the inviter; invite remembered through sign-up; tier picker; request arrives |
| E2E-32 | Pass | Link turned off → "This invite link doesn't work" |
| E2E-33 | Pass | Removal revokes visibility both ways straight away ([WF-135](../ISSUES.md#wf-135--remove-friend-block-leave-make-admin-and-delete-group-happen-on-one-tap-with-no-confirmation): no confirmation) |
| E2E-34 | Pass | Blocked user can't find, add or see the blocker and gets the same reply as for unknown handles ([WF-135](../ISSUES.md#wf-135--remove-friend-block-leave-make-admin-and-delete-group-happen-on-one-tap-with-no-confirmation)) |
| E2E-35 | Pass | Group created, creator is admin; "Create group" disabled without a name |
| E2E-36 | Pass | Signed-out group invite shows only inviter, emoji, name and member count |
| E2E-37 | Pass | Join with T1 preselected |
| E2E-38 | Pass | Joining doesn't make friends; members still see each other |
| E2E-39 | Pass | Default permissions match the spec; admin toggles persist |
| E2E-40 | Pass | No edit form without permission; edit works once granted (server-side check not probed) |
| E2E-41 | Pass | Now filtered by group |
| E2E-42 | Pass | Invite turned off → doesn't work |
| E2E-43 | Pass | Admin must transfer before leaving |
| E2E-44 | Pass | Transfer, then leave; group gone for A ([WF-135](../ISSUES.md#wf-135--remove-friend-block-leave-make-admin-and-delete-group-happen-on-one-tap-with-no-confirmation)) |
| E2E-45 | Pass | Delete group works ([WF-135](../ISSUES.md#wf-135--remove-friend-block-leave-make-admin-and-delete-group-happen-on-one-tap-with-no-confirmation): one tap) |
| E2E-46 | Pass | Template + note ping arrives in the inbox |
| E2E-47 | Pass | 141 characters → Send disabled |
| E2E-48 | Pass | HTML, script and URL shown as literal text; no link |
| E2E-49 | Pass | Busy → "isn't free right now. Ping anyway?" |
| E2E-50 | Pass | Do not disturb → Ping disabled with a reason (server-side not probed) |
| E2E-51 | Pass | One-tap and free-text replies reach the sender with an unread badge |
| E2E-52 | Pass | Pending uploads: dates, Review, View, Delete. View is a signed Storage URL on another host with `nosniff`; another user gets 404. |
| E2E-53 | Pass | Same file again → same job reused |
| E2E-54 | Pass | "Add them" disabled until permission ticked |
| E2E-55 | Pass | Offline friend's upload is a separate job even when the same file is pending for the owner; shifts read correctly; owner's own status unaffected |
| E2E-56 | Pass | The other user never sees the offline friend; direct URL → 404 |
| E2E-57 | Pass | Rename persists; delete asks first and removes the schedule |
| E2E-58 | Pass | All 7 nav items load with the right heading and `aria-current` ([WF-134](../ISSUES.md#wf-134--unbuilt-screens-show-mock-people-and-placeholder-results-to-real-users): Find a time is mock) |
| E2E-59 | Pass* | Phone: no bottom bar, no sideways scroll, drawer works. *Tap targets under 44 px ([WF-136](../ISSUES.md#wf-136--polish-from-the-2026-10-03-e2e-run-plurals-copy-tap-targets-a11y)). |
| E2E-60 | Pass | 404 page with links to Now and home |
| E2E-61 | Pass* | Manifest standalone with 192/512 icons. *Service worker not registered in dev, by design. |
| E2E-62 | Pass | No permission prompt on load; notification settings and install guide render |
