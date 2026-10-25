import type { Signup } from './account';

/** The signup in progress between screens. Memory only: nothing about it is written to disk until it finishes. */
let current: Signup | null = null;

export function setPendingSignup(signup: Signup | null) {
  current = signup;
}

export function pendingSignup(): Signup | null {
  return current;
}
