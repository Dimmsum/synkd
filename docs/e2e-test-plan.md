# End-to-end test plan

Manual/scripted end-to-end checks for the features that are built (`done` or `in-review` in `ISSUES.md` as of 2026-10-03). Each case comes from the acceptance criteria of the issue it names. Results of a run go in a dated report next to this file (`e2e-test-report-YYYY-MM-DD.md`).

## Setup

- `apps/web` on `http://localhost:3000` (`pnpm --filter @whosfree/web dev`), against the Supabase dev project and the Clerk development instance.
- Two users, each in its own browser context (separate cookies and storage):
  - **A**: `e2e-alice+clerk_test@example.com`
  - **B**: `e2e-bob+clerk_test@example.com`
  - Clerk development instances accept the verification code `424242` for `+clerk_test` addresses, so no inbox is needed.
- A test timetable image (a weekly grid with 5–8 classes, some of them with a room number) and a non-image file renamed to `.png`.
- Viewports: desktop 1440×900 and phone 390×844.

## Out of scope for this run

| Area | Why |
|---|---|
| Google sign-in, Google Calendar connect (WF-004 Google path, onboarding calendar step) | Google blocks automated sign-in |
| Push notification delivery and notification-button replies (WF-091, WF-093) | Needs a real device; only the subscription and the in-app inbox are checked |
| Installing the PWA on Android/iOS (WF-090, WF-111) | Needs a device; manifest, service worker and the in-app guide are checked |
| Policy-version re-consent (WF-015, second criterion) | Needs a config change; covered by unit tests |
| Under-18 boundary dates (WF-005) | Covered by unit tests; one under-18 case runs here |
| Friend detail, My schedule, group timeline, slot finder (WF-065, WF-066, WF-098) | Not built yet (`todo`); pages are only checked for not crashing |

## Cases

Legend: **A** / **B** = which user does it. Each case passes only if every expected result holds and the browser console and server log show no errors.

### 1. Sign-up, age gate and consent

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-01 | WF-014 | Signed out, open `/now`, `/friends`, `/settings` | Each sends you to `/sign-in` |
| E2E-02 | WF-014 | Open `/`, `/privacy`, `/terms`, `/help`, `/contact` signed out | Each loads without a redirect |
| E2E-03 | WF-004 | **A** signs up with email + code `424242` | Account created; lands on the age step (`/sign-up/age`) |
| E2E-04 | WF-005 | **A** opens `/now` before confirming age | Redirected back to `/sign-up/age` |
| E2E-05 | WF-005 | On the age step, enter a date of birth under 18 (throwaway third user) | Blocked with a clear message (`/sign-up/not-eligible`); can't reach the app |
| E2E-06 | WF-005 | **A** enters an adult date of birth | Moves on to the terms step; only the birth year is stored (`users.birth_year`, `age_confirmed_at`) |
| E2E-07 | WF-015 | **A** opens `/now` before accepting terms | Redirected to `/sign-up/terms` |
| E2E-08 | WF-015 | **A** accepts terms | `consent_version` and `consent_at` recorded; lands on `/onboarding` |
| E2E-09 | WF-130 | Check **A**'s profile | **A** has a generated handle without a separate step |
| E2E-10 | WF-004 | Close the browser context and reopen it with the same storage | Still signed in |

### 2. Onboarding

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-11 | WF-062, WF-068 | **A** goes through the hours step | "When are you usually up and about?" with 08:00–22:00 every day preset |
| E2E-12 | WF-026 | **A** uploads the non-image file renamed to `.png` | Rejected with a clear message (magic bytes checked on the server) |
| E2E-13 | WF-026, WF-027 | **A** uploads the timetable image | Progress shows queued → reading → ready to review within about a minute |
| E2E-14 | WF-028, WF-029 | **A** opens the review | Week grid with the classes; original file shown beside the grid; low-confidence events highlighted; no room numbers anywhere |
| E2E-15 | WF-029 | **A** edits one event, deletes one, adds one | Changes show in the grid; nothing is saved to the schedule yet |
| E2E-16 | WF-030 | **A** sets the date range and confirms | Schedule committed; the job is `committed`; the file row and draft are gone |
| E2E-17 | WF-068 | **A** finishes the remaining steps (visibility, calendar skip, install skip) | Lands on `/now` |
| E2E-18 | WF-068, WF-031 | **B** signs up and skips every onboarding step | Lands on `/now`; can return to finish setup later |
| E2E-19 | WF-031 | **B** builds a schedule by hand from My schedule | Events saved without an upload |

### 3. Profile, status and hours

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-20 | WF-040 | **A** edits display name and avatar in `/settings/profile` | Saved and shown in the shell |
| E2E-21 | WF-130, WF-040 | **A** changes handle to an invalid one, a reserved word, **B**'s handle in different case, and empty | Each is refused with a message |
| E2E-22 | WF-130 | **A** changes handle to a valid free one | Saved |
| E2E-23 | WF-063 | **A** opens the status chip, sets Busy "until" a time | Status shows Busy until that time, everywhere |
| E2E-24 | WF-063 | **A** clears the override | Back to the calendar-based status |
| E2E-25 | WF-062 | **A** edits hours for a single day in `/settings/hours` | Saved for that day only |

### 4. Friends

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-26 | WF-042 | **A** sends **B** a request by handle | Tier picker shown with T1 preselected; request appears for **B** |
| E2E-27 | WF-042 | **B** accepts, choosing a tier | Both see each other as friends |
| E2E-28 | WF-064 | **A** opens `/now` | **B** listed in the right section with "until X"; status has a text label, not colour alone |
| E2E-29 | WF-041 | **B** sets **A**'s tier to T1, then T2, then T3 | **A** sees status + times at T1, + category at T2, + title at T3; never more |
| E2E-30 | WF-064 | **B** changes status while **A** has `/now` open | **A**'s view updates within about 5 s without reloading |
| E2E-31 | WF-042 | **A** creates a friend invite link `/i/<code>`; a third user opens it signed out | Invite page shows only the inviter; sign-up keeps the invite; tier picker before joining |
| E2E-32 | WF-042 | **A** turns the friend link off and opens it again | Link no longer works |
| E2E-33 | WF-047 | **A** removes **B** | **B** disappears from **A**'s Now and **A** from **B**'s, straight away |
| E2E-34 | WF-047 | **A** re-adds **B**, then **B** blocks **A** | **A** can't see, ping or invite **B**, and isn't told about the block |

### 5. Groups

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-35 | WF-043 | **A** creates a group with a name and emoji | **A** is admin |
| E2E-36 | WF-045 | **A** creates an invite link; **B** opens `/i/<code>` signed out | Shows only the inviter, group name, emoji and member count |
| E2E-37 | WF-045 | **B** joins via `/join/<code>` | Tier picker with T1 preselected; **B** is a member |
| E2E-38 | WF-043 | Check friendship after joining | Joining didn't make **A** and **B** friends |
| E2E-39 | WF-044 | **A** opens `/groups/[id]/settings` | **B** has invite ✓, group ping ✓, manage members ✗, edit group ✗; **A** can toggle each |
| E2E-40 | WF-044 | **B** (without edit permission) tries to rename the group | Not possible |
| E2E-41 | WF-064 | **A** filters `/now` by the group | Only group members shown |
| E2E-42 | WF-045 | **A** revokes the invite; **B**'s link reopened | Link no longer works |
| E2E-43 | WF-043 | **A** tries to leave as admin | Must transfer admin first |
| E2E-44 | WF-043 | **A** transfers admin to **B**, then leaves | **B** is admin; **A** no longer sees the group |
| E2E-45 | WF-043 | **B** deletes the group | Group gone for everyone |

### 6. Pings and inbox

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-46 | WF-092 | **A** pings **B** with a template and text | Appears in **B**'s `/inbox` |
| E2E-47 | WF-092 | **A** types 141 characters | Refused (140 max) |
| E2E-48 | WF-092 | **A** pings text containing `<b>x</b>` and a URL | Shown as plain text; URL not clickable |
| E2E-49 | WF-092 | **B** sets status Busy; **A** pings | Asked to confirm first |
| E2E-50 | WF-092 | **B** sets Do not disturb; **A** pings | Blocked |
| E2E-51 | WF-093 | **B** replies "I'm down", then a short free-text reply | **A** sees the replies in `/inbox` |

### 7. Uploads, offline friends, limits

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-52 | WF-032 | **A** uploads a file and leaves before confirming; opens `/uploads` | Listed with upload date and delete date (+7 days); can view, resume review, delete |
| E2E-53 | WF-035 | **A** uploads the same file again while it's pending | Reuses the job; no extra parse attempt used |
| E2E-54 | WF-127 | **A** adds an offline friend without ticking permission | Not allowed |
| E2E-55 | WF-127 | **A** adds an offline friend with permission, uploads their timetable, confirms | Schedule saved; shows for **A** only |
| E2E-56 | WF-127 | **B** checks Now, friends, groups | **A**'s offline friend never appears to **B**; **A**'s own status unchanged by it |
| E2E-57 | WF-127 | **A** edits the nickname, then deletes the offline friend | Saved; then removed with its schedule |

### 8. Shell, PWA, phone layout

| ID | Issue | Steps | Expected |
|---|---|---|---|
| E2E-58 | WF-014 | Desktop: visit each nav item | Now, Schedule, Friends, Groups, Find a time, Inbox, Settings all load |
| E2E-59 | WF-014 | Phone: open each nav item from the hamburger drawer | No bottom bar; drawer works; tap targets ≥ 44×44 px |
| E2E-60 | WF-014 | Open `/does-not-exist` | 404 page with a way back |
| E2E-61 | WF-090 | Fetch `/manifest.webmanifest` and the service worker | Manifest has icons and `display: standalone`; SW registers |
| E2E-62 | WF-091, WF-111 | Open `/settings/notifications` and `/settings/install` | Explanation shown before any permission prompt; install guide renders; nothing asks for permission on first load |
