import type { IconName } from '@/components/ui/icon';
import type { Audience } from '@/lib/addressbook';

/** The icon beside who my post is for: a lock only for Only me, a globe for Everyone, a circle for my circles. Pure. */
export function audienceIcon(kind: Audience['kind'] | undefined): IconName {
  return kind === 'onlyMe' ? 'lock-closed' : kind === 'everyone' ? 'globe-outline' : 'ellipse-outline';
}
