// Counts with the right noun (WF-136): "1 friend", "2 friends", "0 members".

/** `n` and the noun for it: `plural` defaults to `singular` + "s". */
export function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${String(n)} ${n === 1 ? singular : plural}`;
}
