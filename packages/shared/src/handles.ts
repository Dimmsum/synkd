// Handle rules (WF-040, FR-AUTH-2). The database enforces the same rules with
// CHECK constraints on `users.handle` (backend migration
// 20261001100100_profiles_and_handles.sql); a backend test checks that the
// reserved list there matches RESERVED_HANDLES exactly.
import { z } from 'zod';

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

/**
 * ASCII letters, digits and underscores, starting with a letter. ASCII only,
 * so look-alike Unicode characters can't be used to impersonate someone.
 * Handles keep the case the user typed (`@KemarJ`) but are unique ignoring case.
 */
export const HANDLE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Handles nobody can take (compared ignoring case): app routes, staff-like
 * names and words that could be mistaken for the app itself. Any handle
 * containing "whosfree" is also refused.
 */
export const RESERVED_HANDLES = [
  'about',
  'account',
  'accounts',
  'admin',
  'administrator',
  'anon',
  'anonymous',
  'api',
  'app',
  'auth',
  'blog',
  'calendar',
  'contact',
  'dashboard',
  'email',
  'everyone',
  'explore',
  'friend',
  'friends',
  'group',
  'groups',
  'help',
  'here',
  'home',
  'i',
  'import',
  'inbox',
  'invite',
  'invites',
  'legal',
  'login',
  'logout',
  'mail',
  'me',
  'mod',
  'moderator',
  'news',
  'notifications',
  'now',
  'null',
  'official',
  'onboarding',
  'ping',
  'pings',
  'privacy',
  'profile',
  'register',
  'root',
  'schedule',
  'search',
  'security',
  'settings',
  'share',
  'sign_in',
  'sign_up',
  'signin',
  'signup',
  'staff',
  'status',
  'support',
  'system',
  'team',
  'terms',
  'undefined',
  'upload',
  'user',
  'users',
  'webhook',
  'webhooks',
  'whosfree',
  'www',
] as const;

/** The substring no handle may contain, ignoring case. */
export const RESERVED_HANDLE_SUBSTRING = 'whosfree';

const reserved = new Set<string>(RESERVED_HANDLES);

/** True if `handle` is reserved (ignoring case). */
export function isReservedHandle(handle: string): boolean {
  const key = handle.toLowerCase();
  return reserved.has(key) || key.includes(RESERVED_HANDLE_SUBSTRING);
}

/** What the user typed, trimmed and without one leading `@`. The database normalises the same way. */
export function normalizeHandleInput(input: string): string {
  return input.trim().replace(/^@/, '');
}

/** A handle as stored: already normalised (no `@`, no surrounding spaces). */
export const Handle = z
  .string()
  .min(HANDLE_MIN_LENGTH, `Handles are at least ${HANDLE_MIN_LENGTH} characters`)
  .max(HANDLE_MAX_LENGTH, `Handles are at most ${HANDLE_MAX_LENGTH} characters`)
  .regex(HANDLE_PATTERN, 'Use letters, numbers and underscores, starting with a letter')
  .refine((h) => !isReservedHandle(h), 'That handle is reserved');
export type Handle = z.infer<typeof Handle>;

/** A handle as typed into a form (`@kemar`, ` kemar `), normalised then checked like `Handle`. */
export const HandleInput = z.string().transform(normalizeHandleInput).pipe(Handle);
