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
