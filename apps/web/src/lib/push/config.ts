// VAPID configuration for sending Web Push (WF-091). Server only: the private key must never
// reach the browser. The owner generates the pair once (`npx web-push generate-vapid-keys`)
// and sets it in the root `.env` locally and in Vercel's settings (see `.env.example`).
//
// Missing or malformed values make push "not configured": sending is skipped with a warning
// that names the variables (never their values), and the in-app inbox still works
// (NFR-COMPAT-2). Nothing throws, so a ping never fails because push isn't set up.

import 'server-only';

export interface VapidConfig {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export type VapidConfigResult =
  { ok: true; config: VapidConfig } | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

// base64url without padding, as `web-push generate-vapid-keys` prints them: an uncompressed
// P-256 public key is 65 bytes (87 characters), the private key 32 bytes (43 characters).
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;
const PRIVATE_KEY = /^[A-Za-z0-9_-]{43}$/;

function validSubject(subject: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+$/.test(subject)) return true;
  try {
    const url = new URL(subject);
    return url.protocol === 'https:' && url.hostname !== 'localhost';
  } catch {
    return false;
  }
}

/**
 * Reads and checks the VAPID variables. Problems name the variable and what's wrong with it,
 * never its value, so they are safe to log (NFR-SEC-11).
 */
export function readVapidConfig(env: Env = process.env): VapidConfigResult {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '';
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? '';
  const subject = env.VAPID_SUBJECT?.trim() ?? '';
  const problems: string[] = [];

  if (!publicKey) problems.push('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set');
  else if (!PUBLIC_KEY.test(publicKey))
    problems.push('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not a VAPID public key');
  if (!privateKey) problems.push('VAPID_PRIVATE_KEY is not set');
  else if (!PRIVATE_KEY.test(privateKey))
    problems.push('VAPID_PRIVATE_KEY is not a VAPID private key');
  if (!subject) problems.push('VAPID_SUBJECT is not set');
  else if (!validSubject(subject))
    problems.push('VAPID_SUBJECT must be a mailto: address or a public https: URL');

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { subject, publicKey, privateKey } };
}
