/**
 * An invite link that opened the app (or the web app) before it could be used, e.g. while signed out. Memory only: it's
 * offered on the "Got an invite?" screen once the person is signed in.
 */
let pending: string | null = null;

export function setPendingInvite(link: string) {
  pending = link;
}

/** The waiting invite link, once. */
export function takePendingInvite(): string | null {
  const link = pending;
  pending = null;
  return link;
}
