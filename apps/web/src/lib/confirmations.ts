// What the app asks before an action that's hard to take back (WF-135, FR-SOC-6, FR-SOC-8).
// One tap opens the question; only the second, on the confirm button, runs the action
// (components/app/confirm-action-button.tsx). Pure, so the wording is tested.

export interface Confirmation {
  title: string;
  description: string;
  /** The button that closes the question and changes nothing. */
  keep: string;
  /** The button that runs the action. */
  confirm: string;
}

const first = (name: string) => name.split(' ')[0] ?? name;

export const CONFIRM = {
  /** `unfriend`: friend rules on both sides go; shared groups still apply (resolve_tier). */
  removeFriend: (name: string): Confirmation => ({
    title: `Remove ${first(name)}?`,
    description: `You stop sharing with each other as friends straight away. Groups you’re both in still apply. To be friends again, one of you sends a new request.`,
    keep: `Keep ${first(name)}`,
    confirm: 'Remove',
  }),
  /** `block_user` (FR-SOC-6): silent, and ends the friendship. */
  block: (name: string): Confirmation => ({
    title: `Block ${first(name)}?`,
    description: `They can’t see, ping or invite you, and they aren’t told. Your friendship ends.`,
    keep: 'Cancel',
    confirm: `Block ${first(name)}`,
  }),
  /** `transfer_admin` (FR-SOC-8): only the new admin can give it back. */
  makeAdmin: (name: string): Confirmation => ({
    title: `Make ${first(name)} the admin?`,
    description: `You stop being the admin straight away. Only ${first(name)} can make you the admin again.`,
    keep: 'Cancel',
    confirm: 'Make admin',
  }),
  leaveGroup: (group: string): Confirmation => ({
    title: `Leave ${group}?`,
    description: `You stop seeing the group, and its members stop seeing you through it. To come back, you need a new invite.`,
    keep: 'Stay',
    confirm: 'Leave group',
  }),
  /** `delete_group`: gone for every member. */
  deleteGroup: (group: string): Confirmation => ({
    title: `Delete ${group}?`,
    description: `The group and its invite links are deleted for every member. This can’t be undone.`,
    keep: `Keep ${group}`,
    confirm: 'Delete group',
  }),
} as const;
