'use server';

// In-app feedback and bug reports (FR-WEB-10, WF-137): `submit_feedback` stores it as the
// signed-in user, rate limited to FEEDBACK_PER_DAY. The team reads it in the Supabase dashboard.
// Never log the message (NFR-SEC-11).

import { auth } from '@clerk/nextjs/server';
import { FeedbackInput } from '@synkd/shared';
import { feedbackErrorMessage } from '@/lib/db-errors';
import { createServerSupabase } from '@/lib/supabase/server';
import { fail, ok, type ActionResult } from './result';

export async function sendFeedback(input: FeedbackInput): Promise<ActionResult> {
  const { userId } = await auth();
  if (userId === null) return fail('Sign in to send feedback.');

  const parsed = FeedbackInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Only the message's problems are something the user can fix; the rest is a bug here.
    return fail(issue?.path[0] === 'message' ? issue.message : 'Check your message and try again.');
  }

  const f = parsed.data;
  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('submit_feedback', {
    kind: f.kind,
    message: f.message,
    page: f.page ?? undefined,
    device_label: f.device ?? undefined,
    installed: f.installed,
    can_contact: f.canContact,
  });
  if (error) {
    // The code only: never the message (NFR-SEC-11).
    console.error('submit_feedback failed', error.code);
    return fail(feedbackErrorMessage(error.code));
  }
  return ok;
}
