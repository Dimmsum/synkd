// Constants shared by web, backend, worker and parser. The PRD reference is next to each one.

/** Statuses a viewer can see (PRD §6.6). */
export const STATUSES = ['free', 'busy', 'dnd', 'away', 'no_schedule', 'paused'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Statuses a user can set by hand (PRD §9 `statusOverrides`, J5).
 * `focused` ("Studying/Focused") is shown to viewers as `busy`.
 */
export const MANUAL_STATUSES = ['free', 'busy', 'dnd', 'away', 'focused'] as const;
type ManualStatus = (typeof MANUAL_STATUSES)[number];

export const MANUAL_STATUS_TO_STATUS = {
  free: 'free',
  busy: 'busy',
  dnd: 'dnd',
  away: 'away',
  focused: 'busy',
} as const satisfies Record<ManualStatus, Status>;

/** How a manual status is named in the UI (J5, FR-AVL-3). */
export const MANUAL_STATUS_LABELS = {
  free: 'Free',
  busy: 'Busy',
  dnd: 'Do not disturb',
  away: 'Away',
  focused: 'Studying/Focused',
} as const satisfies Record<ManualStatus, string>;

/**
 * Manual status limits (PRD §9 `statusOverrides`, FR-AVL-3). The database enforces the same in
 * `set_status` (backend migration 20261001300400_status_overrides.sql): an optional label of at
 * most 40 characters, and an end time at most 7 days away (anything longer is "until I change it").
 */
export const STATUS_LABEL_MAX_LENGTH = 40;
export const STATUS_OVERRIDE_MAX_DAYS = 7;

/**
 * Manual status changes per user per hour (FR-AVL-3, NFR-SEC-9, WF-063). Each one sends a
 * Realtime "changed" signal to every connection, so it is limited like other abusable writes.
 * `set_status` enforces it (backend migration 20261003200000_set_status_rate_limit.sql);
 * `clear_status` is never limited.
 */
export const STATUS_CHANGES_PER_HOUR = 60;

/** Visibility tiers (PRD §6.7, D1). T1 is the default and the minimum (D20). */
export const TIERS = [1, 2, 3] as const;
type Tier = (typeof TIERS)[number];
export const DEFAULT_TIER: Tier = 1;

export const TIER_LABELS = {
  1: 'Free/Busy',
  2: 'Category',
  3: 'Details',
} as const satisfies Record<Tier, string>;

/**
 * Event fields each tier reveals, on top of status and times.
 * There is no location field at any tier (D35).
 */
export const TIER_VISIBLE_EVENT_FIELDS = {
  1: [],
  2: ['category'],
  3: ['category', 'title'],
} as const satisfies Record<Tier, readonly ('category' | 'title')[]>;

/** Event categories (PRD §9 `events.category`, FR-IMP-3). */
export const EVENT_CATEGORIES = [
  'class',
  'lab',
  'tutorial',
  'work',
  'meeting',
  'event',
  'other',
] as const;

export const DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Group member permissions (FR-SOC-8, D26). */
export const GROUP_PERMISSIONS = ['invite', 'manageMembers', 'editGroup', 'groupPing'] as const;
export type GroupPermission = (typeof GROUP_PERMISSIONS)[number];
export type GroupPermissions = Record<GroupPermission, boolean>;

export const DEFAULT_MEMBER_PERMISSIONS = {
  invite: true,
  manageMembers: false,
  editGroup: false,
  groupPing: true,
} as const satisfies GroupPermissions;

/** Default group size cap. Stored per group so it can be raised without a schema change (NFR-SCALE-4). */
export const DEFAULT_GROUP_MAX_MEMBERS = 20;

/**
 * Invite link codes (FR-SOC-3, WF-045): 128 random bits, base64url without padding. The
 * database generates them and checks the same shape (`invites.code`, backend migration
 * 20261001200100_invites.sql); clients use it to reject a mangled code before asking.
 */
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Offline friends (D44): people who aren't on whosfree, added by a user with a nickname and a
 * schedule. At most this many per user (FR-SOC-18). The database enforces the same cap in
 * `create_offline_friend` (backend migration 20261002300000_offline_friends.sql).
 */
export const MAX_OFFLINE_FRIENDS = 20;

/** Offline friend nickname length, in characters (PRD §9 `offlineFriends`, FR-SOC-14). */
export const OFFLINE_FRIEND_NICKNAME_MAX_LENGTH = 40;

/**
 * Web Push devices per user (PRD §9 `pushSubscriptions`, FR-PING-3, WF-091). Saving an 11th
 * drops the least recently used one. The database enforces the same cap in
 * `save_push_subscription` (backend migration 20261002500000_push_subscriptions.sql).
 */
export const MAX_PUSH_SUBSCRIPTIONS = 10;

/**
 * Longest device label stored with a push subscription, e.g. "Chrome on Android". A coarse
 * label instead of the raw user agent (NFR-SEC-1, PRD §9 `pushSubscriptions.userAgent`).
 */
export const PUSH_DEVICE_LABEL_MAX_LENGTH = 60;

/** Ping templates (J3) and one-tap replies (FR-PING-4). */
export const PING_TEMPLATES = ['Free for food?', 'Wanna study?', 'Link up?', 'Call me'] as const;
export type PingTemplate = (typeof PING_TEMPLATES)[number];

export const PING_REPLIES = ["I'm down", 'In 10', "Can't right now"] as const;
export type PingReply = (typeof PING_REPLIES)[number];

/** Free-text ping limit, in characters (D31). Replies use the same limit (FR-PING-4). */
export const PING_TEXT_MAX_LENGTH = 140;

/**
 * Pings expire this many minutes after they're sent (FR-PING-9 [ASSUMPTION]). The database sets
 * `pings.expires_at` to match (backend migration 20261003000000_pings.sql); enforcing it on
 * replies is WF-097.
 */
export const PING_EXPIRY_MINUTES = 120;

/**
 * Pings one sender can send per day (FR-PING-6, NFR-SEC-9), enforced in `send_ping`. The
 * per-recipient limit (3 an hour) is WF-094.
 */
export const PING_DAILY_LIMIT = 30;

/**
 * Onboarding steps after sign-up, in order (J1, FR-WEB-5, WF-068): available hours, schedule
 * upload/review, Google Calendar, the group tier picker (only when arriving through an invite)
 * and install + notifications. `users.onboarding_steps` records which ones the user has done or
 * skipped, and accepts exactly these (backend migration 20261003400000_onboarding_progress.sql).
 */
export const ONBOARDING_STEPS = ['hours', 'schedule', 'calendar', 'sharing', 'install'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Available hours default: 08:00–22:00 every day (D24). */
export const DEFAULT_AVAILABLE_HOURS = { start: '08:00', end: '22:00' } as const;

export const DEFAULT_TIMEZONE = 'America/Jamaica';

/**
 * Profile photos (FR-AUTH-2, WF-040). Users can replace the Google photo, or add one after email
 * sign-up. The web server checks the file's type by its first bytes, then re-encodes it as a
 * square WebP of AVATAR_SIZE_PX without any metadata (no EXIF, so no GPS: D35) and stores it in
 * the public Storage bucket AVATAR_BUCKET under `<users.id>/<random>.webp` (backend migration
 * 20261003200200_avatars_bucket.sql, which also caps stored files at AVATAR_STORED_MAX_BYTES and
 * explains why the bucket is public).
 */
export const AVATAR_BUCKET = 'avatars';
export const AVATAR_SIZE_PX = 256;
export const AVATAR_STORED_MAX_BYTES = 256 * 1024;
/**
 * Largest photo the server accepts, in bytes. It fits in a Server Action request (1 MB by
 * default); the browser shrinks bigger photos before sending them (NFR-PERF-6).
 */
export const AVATAR_UPLOAD_MAX_BYTES = 900 * 1024;
/** File types accepted for a profile photo, checked by magic bytes on the server. */
export const AVATAR_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarUploadType = (typeof AVATAR_UPLOAD_TYPES)[number];

/** Display name length, in characters (PRD §9 `users.name`, FR-AUTH-2). The database checks 1–100. */
export const DISPLAY_NAME_MAX_LENGTH = 100;

export const SOURCE_TYPES = ['upload', 'manual', 'gcal'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * The source types `commit_schedule` writes (WF-030): a confirmed upload or a schedule typed in
 * by hand (FR-IMP-12). Google Calendar sources come from sync (WF-080), never from a commit.
 */
export const COMMIT_SOURCE_TYPES = ['manual', 'upload'] as const;
export type CommitSourceType = (typeof COMMIT_SOURCE_TYPES)[number];

/** Event title length, in characters (PRD §9 `events.title`, FR-IMP-3). `commit_schedule` checks it too. */
export const EVENT_TITLE_MAX_LENGTH = 120;

/** Most events in one parse draft or schedule commit (PRD §8.5, NFR-SEC-7, WF-030). */
export const SCHEDULE_MAX_EVENTS = 200;

/**
 * Longest schedule period, in days counting both ends (FR-IMP-7): a school year or a long
 * roster. A new period is added when it ends (J6). `commit_schedule` checks the same.
 */
export const SCHEDULE_PERIOD_MAX_DAYS = 366;

/** Most exceptions (breaks, holidays, exams) on one schedule period (FR-IMP-8). */
export const SCHEDULE_MAX_EXCEPTIONS = 50;

/** Schedule exception label length, in characters (FR-IMP-8), e.g. "Reading week". */
export const SCHEDULE_EXCEPTION_LABEL_MAX_LENGTH = 60;

/**
 * Schedule commits (confirmed uploads plus manual saves) per user per day (NFR-SEC-9, WF-030),
 * shared by the user's own schedule and their offline friends'. `commit_schedule` enforces it.
 */
export const SCHEDULE_COMMITS_PER_DAY = 20;

export const PARSE_JOB_STATUSES = [
  'queued',
  'processing',
  'needs_review',
  'committed',
  'failed',
] as const;
export type ParseJobStatus = (typeof PARSE_JOB_STATUSES)[number];

// ---------------------------------------------------------------------------
// Schedule files and parsing (FR-IMP-1, FR-IMP-13–16, FR-IMP-19, NFR-SEC-6, NFR-PERF-6, D38, D46)
// ---------------------------------------------------------------------------

/** Largest schedule file, in bytes (FR-IMP-1). The Storage bucket enforces the same limit. */
export const SCHEDULE_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** Most pages in a PDF schedule (FR-IMP-1, NFR-COST-1). */
export const SCHEDULE_FILE_MAX_PDF_PAGES = 5;

/**
 * Media types a schedule file may be stored as (FR-IMP-1). The Storage bucket's
 * `allowed_mime_types` and `schedule_files.mime_type` use the same list; the server still
 * checks the file's magic bytes before reading it (NFR-SEC-6).
 */
export const SCHEDULE_FILE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export type ScheduleFileMimeType = (typeof SCHEDULE_FILE_MIME_TYPES)[number];

/**
 * Longest edge of an image after on-device compression (NFR-PERF-6), and of the images the
 * server sends to the model (WF-024).
 */
export const SCHEDULE_IMAGE_MAX_EDGE_PX = 2000;

/** Days an unconfirmed file is kept before it's deleted (FR-IMP-15, D38). */
export const SCHEDULE_FILE_RETENTION_DAYS = 7;

/** The private Storage bucket schedule files are uploaded to (WF-026, NFR-SEC-6). */
export const SCHEDULE_FILES_BUCKET = 'schedule-files';

/** Longest file name kept for an upload, so the user can recognise it in Pending uploads. */
export const SCHEDULE_FILE_NAME_MAX_LENGTH = 120;

/**
 * Parse attempts per user per day (FR-IMP-19, NFR-COST-1, WF-035): starting a parse or retrying
 * a failed one. Offline friends' parses count too (WF-127). Re-using a pending job for an
 * identical file (same sha256) doesn't. `start_parse_job` enforces it ('parse').
 */
export const PARSE_ATTEMPTS_PER_DAY = 5;

/**
 * Uploads started per user per day (NFR-SEC-9), including ones never parsed, so Storage can't be
 * filled up. `create_schedule_upload` enforces it ('schedule_upload').
 */
export const SCHEDULE_UPLOADS_PER_DAY = 20;

/** Most unconfirmed uploads one user can have at a time (FR-IMP-16). */
export const MAX_PENDING_UPLOADS = 10;

/**
 * Model runs per parse job before it's marked failed (NFR-REL-2, WF-027): one LLM attempt per
 * run, retried through the queue with backoff (D46).
 */
export const PARSE_JOB_MAX_ATTEMPTS = 3;

/**
 * The parser that produced a draft, recorded on `parse_jobs.parser_version` (PRD §9, WF-027):
 * the code version (prompt + post-processing) and the prompt it used. Bump it whenever the
 * prompt, the title scrubber or the normalisation changes, so eval runs and jobs stay comparable.
 */
export const PARSE_PROMPT_VERSION = 'v2';
export const PARSER_VERSION = `1.0+prompt.${PARSE_PROMPT_VERSION}`;

/**
 * OpenRouter models for schedule parsing (D15, PRD §8.4): a cheap vision model with structured
 * output, and a fallback from another provider family that OpenRouter tries when the first
 * fails. Both are PROVISIONAL, picked from OpenRouter's catalogue and one synthetic smoke test
 * on 2026-09-30; WF-023 must confirm them on the eval set (≥ 70 % acceptance, ≤ US$0.05 a
 * parse, NFR-COST-1) before launch.
 *
 * Every model listed must have a zero-data-retention endpoint (NFR-SEC-8, see
 * https://openrouter.ai/api/v1/endpoints/zdr) that supports `temperature` and
 * `response_format`: requests set `require_parameters`, so a model without them (e.g.
 * gemini-3.5-flash-lite, gpt-5.4-nano on 2026-09-30) gets no endpoint at all (HTTP 404).
 *
 * Smoke test (2026-09-30, synthetic-week.png, ZDR on): with gemini-3.1-flash-lite first,
 * OpenRouter served mistral-small-2603, which returned the expected draft exactly (4 events,
 * the period and its break) for US$0.0005. So the model that has actually answered goes first;
 * gemini-3.1-flash-lite is unverified.
 */
export const PARSE_MODEL_PRIMARY = 'mistralai/mistral-small-2603';
export const PARSE_MODEL_FALLBACK = 'google/gemini-3.1-flash-lite';

/**
 * Why a parse job failed, stored on `parse_jobs.error` (FR-IMP-14). A code only, never model
 * output or anything from the file (NFR-SEC-11); the UI turns it into a message.
 *   unsupported_file   not a PDF, PNG, JPEG, WebP or HEIC by its magic bytes (NFR-SEC-6), or
 *                      not the file that was uploaded
 *   file_too_large     over SCHEDULE_FILE_MAX_BYTES
 *   too_many_pages     a PDF over SCHEDULE_FILE_MAX_PDF_PAGES
 *   image_too_large    an image or PDF page too big to decode safely (WF-024 §8)
 *   unreadable_file    damaged, empty or password-protected
 *   file_missing       the upload never reached Storage
 *   no_schedule_found  the model found no events
 *   parse_failed       the model failed every attempt (errors, invalid output)
 *   timed_out          the last run never finished (crash or timeout)
 */
export const PARSE_ERROR_CODES = [
  'unsupported_file',
  'file_too_large',
  'too_many_pages',
  'image_too_large',
  'unreadable_file',
  'file_missing',
  'no_schedule_found',
  'parse_failed',
  'timed_out',
] as const;
export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number];

/**
 * Realtime "changed" signals (PRD §8.1, FR-VIEW-3, NFR-PERF-3, D41). Each user has one private
 * Broadcast channel, `user:<users.id>`, that only they can join. Database triggers send
 * {@link NOW_CHANGED_EVENT} on it, with an empty payload, whenever something their Now screen
 * shows changes; the client then re-fetches `now_for_viewer`.
 */
export const REALTIME_USER_CHANNEL_PREFIX = 'user:';
export const NOW_CHANGED_EVENT = 'now_changed';

/**
 * Sent on the same private channel, with an empty payload, when a ping or a reply arrives for
 * (or is sent by) that user (WF-092, WF-093). The inbox then re-fetches `list_inbox`. Never
 * carries the ping, its text or who sent it (D41, NFR-SEC-11).
 */
export const INBOX_CHANGED_EVENT = 'inbox_changed';

/**
 * Sent on the same private channel, with an empty payload, when one of the user's parse jobs or
 * pending uploads changes (FR-IMP-13, WF-027): queued, processing, ready for review, failed,
 * committed or deleted. The upload card and Pending uploads then re-read the job.
 */
export const PARSE_JOB_CHANGED_EVENT = 'parse_job_changed';

/** The private Realtime channel topic of the user with this `users.id`. */
export function userChannel(userId: string): string {
  return `${REALTIME_USER_CHANNEL_PREFIX}${userId}`;
}
