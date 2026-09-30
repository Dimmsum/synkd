// Helpers for asserting on the SQLSTATE a query fails with.

import type { Transaction } from '@electric-sql/pglite';

/** Resolves to the SQLSTATE `promise` fails with, or 'ok' if it succeeds. */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code !== 'string') throw error;
    return code;
  }
}

/** Resolves to the `{ code, message }` that `promise` fails with (throws if it succeeds). */
export async function errorOf(
  promise: Promise<unknown>,
): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof code !== 'string' || typeof message !== 'string') throw error;
    return { code, message };
  }
  throw new Error('expected the query to fail');
}

/**
 * Like `codeOf` for a statement inside a larger transaction: runs it under a
 * savepoint and rolls back to it on failure, so the transaction can go on.
 */
export async function codeInTx(
  tx: Transaction,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  await tx.query('savepoint code_in_tx');
  const code = await codeOf(tx.query(sql, params));
  await tx.query(
    code === 'ok' ? 'release savepoint code_in_tx' : 'rollback to savepoint code_in_tx',
  );
  return code;
}
