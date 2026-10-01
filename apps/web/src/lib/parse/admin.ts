// The parse pipeline's secret-key (service role) access to Supabase (WF-026, WF-027, D41, D46).
//
// Deliberately narrow, like lib/push/store.ts: the server-only parse functions
// (claim/complete/fail, the sweep's halves) and the private `schedule-files` bucket: sign an
// upload URL for a path the database chose, sign a short-lived read URL, download, remove.
// Never used to act on a user's behalf: every user-facing check (whose file, whose job, the
// rate limits) happens first in a database function called with the user's own token
// (createServerSupabase), and only the storage path that function returned is used here.
//
// Logging (NFR-SEC-11): error codes and HTTP statuses only, never a path's contents, a draft or
// a signed URL.

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, ParseRun } from '@whosfree/backend';
import { SCHEDULE_FILES_BUCKET, type ParseDraft, type ParseErrorCode } from '@whosfree/shared';

/** What the run route, the sweep and the import actions need from the secret key. */
export interface ParseAdmin {
  claim(jobId: string, leaseSeconds: number): Promise<ParseRun | null>;
  complete(input: {
    jobId: string;
    attempt: number;
    draft: ParseDraft;
    model: string;
    parserVersion: string;
    costUsd: number | null;
    confidence: number;
    pages: number;
  }): Promise<boolean>;
  fail(input: {
    jobId: string;
    attempt: number;
    error: ParseErrorCode;
    retryable: boolean;
    model?: string | null;
    parserVersion?: string | null;
    costUsd?: number | null;
  }): Promise<string | null>;
  listDue(max: number): Promise<string[]>;
  expireFiles(max: number): Promise<number>;
  claimRemovals(max: number): Promise<string[]>;
  finishRemovals(paths: string[]): Promise<number>;
  /** The object's bytes, or null if there is no such object. */
  download(path: string): Promise<Uint8Array | null>;
  /** Removes objects; true when Storage accepted the request (missing objects count as gone). */
  remove(paths: string[]): Promise<boolean>;
  signUpload(path: string): Promise<{ path: string; token: string }>;
  /** A read URL valid for `seconds`. */
  signRead(path: string, seconds: number): Promise<string>;
}

type Env = Record<string, string | undefined>;

/** Wraps a service-role client. Exported for tests; use createParseAdmin(). */
export function parseAdminFrom(client: SupabaseClient<Database>): ParseAdmin {
  const bucket = () => client.storage.from(SCHEDULE_FILES_BUCKET);
  return {
    async claim(jobId, leaseSeconds) {
      const { data, error } = await client.rpc('claim_parse_job', {
        job_id: jobId,
        lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`claim_parse_job failed (${error.code})`);
      return data[0] ?? null;
    },
    async complete(input) {
      const { data, error } = await client.rpc('complete_parse_job', {
        job_id: input.jobId,
        attempt: input.attempt,
        draft: input.draft as unknown as Json,
        model: input.model,
        parser_version: input.parserVersion,
        ...(input.costUsd !== null ? { cost_usd: input.costUsd } : {}),
        confidence: input.confidence,
        pages: input.pages,
      });
      if (error) throw new Error(`complete_parse_job failed (${error.code})`);
      return data;
    },
    async fail(input) {
      const { data, error } = await client.rpc('fail_parse_job', {
        job_id: input.jobId,
        attempt: input.attempt,
        error: input.error,
        retryable: input.retryable,
        ...(input.model ? { model: input.model } : {}),
        ...(input.parserVersion ? { parser_version: input.parserVersion } : {}),
        ...(input.costUsd != null ? { cost_usd: input.costUsd } : {}),
      });
      if (error) throw new Error(`fail_parse_job failed (${error.code})`);
      return data;
    },
    async listDue(max) {
      const { data, error } = await client.rpc('list_due_parse_jobs', { max_jobs: max });
      if (error) throw new Error(`list_due_parse_jobs failed (${error.code})`);
      return data;
    },
    async expireFiles(max) {
      const { data, error } = await client.rpc('expire_schedule_files', { max_files: max });
      if (error) throw new Error(`expire_schedule_files failed (${error.code})`);
      return data;
    },
    async claimRemovals(max) {
      const { data, error } = await client.rpc('claim_storage_removals', { max_paths: max });
      if (error) throw new Error(`claim_storage_removals failed (${error.code})`);
      return data.map((r) => r.storage_path);
    },
    async finishRemovals(paths) {
      if (paths.length === 0) return 0;
      const { data, error } = await client.rpc('finish_storage_removals', { paths });
      if (error) throw new Error(`finish_storage_removals failed (${error.code})`);
      return data;
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error) {
        const status = 'status' in error ? Number(error.status) : undefined;
        if (status === 404 || status === 400 || /not.?found/i.test(error.message)) return null;
        throw new Error(`Storage download failed (${status ?? 'error'})`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(paths) {
      if (paths.length === 0) return true;
      const { error } = await bucket().remove(paths);
      if (error) {
        console.warn('Storage removal failed', 'status' in error ? error.status : 'error');
        return false;
      }
      return true;
    },
    // Storage's message ("Bucket not found", "Invalid Compact JWS") is what tells a missing
    // bucket apart from a bad key: both are a 400. It never carries the path or a URL.
    async signUpload(path) {
      const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
      if (error) {
        throw new Error(
          `Signing an upload URL failed (${error.status ?? 'error'}: ${error.message})`,
        );
      }
      return { path: data.path, token: data.token };
    },
    async signRead(path, seconds) {
      const { data, error } = await bucket().createSignedUrl(path, seconds);
      if (error) {
        throw new Error(`Signing a read URL failed (${error.status ?? 'error'}: ${error.message})`);
      }
      return data.signedUrl;
    },
  };
}

/**
 * The parse admin, or the reasons it can't be built (variable names only, never values).
 */
export function createParseAdmin(
  env: Env = process.env,
): { ok: true; admin: ParseAdmin } | { ok: false; problems: string[] } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const problems: string[] = [];
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!secretKey) problems.push('SUPABASE_SECRET_KEY is not set');
  if (!url || !secretKey) return { ok: false, problems };
  const client = createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { ok: true, admin: parseAdminFrom(client) };
}

/** createParseAdmin() or throw (for routes and actions that can't do anything without it). */
export function requireParseAdmin(): ParseAdmin {
  const made = createParseAdmin();
  if (!made.ok) throw new Error(`Parse pipeline not configured: ${made.problems.join('; ')}`);
  return made.admin;
}

/**
 * Removes Storage objects straight away and forgets them in the removal queue (D38). Never
 * throws: whatever isn't removed stays queued for the sweep.
 */
export async function removeNow(paths: string[], admin?: ParseAdmin): Promise<void> {
  try {
    const client = admin ?? requireParseAdmin();
    if (await client.remove(paths)) await client.finishRemovals(paths);
  } catch (err) {
    console.warn('Immediate file removal failed; the sweep will retry', (err as Error).message);
  }
}
