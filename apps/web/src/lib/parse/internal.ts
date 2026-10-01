// Authentication and addressing of the internal routes (parse run and sweep, D46; NFR-SEC-5 as
// retargeted by the WF-024 spike §11): our own server and the cron are the only callers, and
// both send `Authorization: Bearer <CRON_SECRET>`. Without the secret the routes refuse
// everything.

import { createHash, timingSafeEqual } from 'node:crypto';

type Env = Record<string, string | undefined>;

/** Shortest CRON_SECRET accepted; `openssl rand -base64 32` gives 44 characters. */
export const MIN_SECRET_LENGTH = 24;

/** The shared secret, or null when it isn't set (or is too short to be one). */
export function internalSecret(env: Env = process.env): string | null {
  const secret = env.CRON_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Whether the request carries the secret, compared in constant time. */
export function isInternalRequest(request: Request, env: Env = process.env): boolean {
  const secret = internalSecret(env);
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]) return false;
  return timingSafeEqual(digest(match[1].trim()), digest(secret));
}

/**
 * Where the server reaches its own internal routes: `INTERNAL_APP_URL` (e.g.
 * `http://127.0.0.1:3000` behind a proxy) or else the public `NEXT_PUBLIC_APP_URL`.
 */
export function internalBaseUrl(env: Env = process.env): string | null {
  const url = (env.INTERNAL_APP_URL || env.NEXT_PUBLIC_APP_URL)?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export const PARSE_RUN_PATH = '/api/internal/parse-jobs/run';
export const PARSE_SWEEP_PATH = '/api/internal/parse-jobs/sweep';
