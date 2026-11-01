import { Image } from 'expo-image';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';

/** `id`: the person's user id (or a group chat's id), which picks their colour. */
type Props = { id?: string; name?: string; uri?: string | null; size?: 'sm' | 'md' | 'lg' };

/** Spelled out in full so Tailwind finds every class (tokens.js `avatar`). */
export const AVATAR_COLORS = [
  { bg: 'bg-avatar-1 dark:bg-avatar-1-dark', text: 'text-avatar-1-ink dark:text-avatar-1-ink-dark' },
  { bg: 'bg-avatar-2 dark:bg-avatar-2-dark', text: 'text-avatar-2-ink dark:text-avatar-2-ink-dark' },
  { bg: 'bg-avatar-3 dark:bg-avatar-3-dark', text: 'text-avatar-3-ink dark:text-avatar-3-ink-dark' },
  { bg: 'bg-avatar-4 dark:bg-avatar-4-dark', text: 'text-avatar-4-ink dark:text-avatar-4-ink-dark' },
  { bg: 'bg-avatar-5 dark:bg-avatar-5-dark', text: 'text-avatar-5-ink dark:text-avatar-5-ink-dark' },
  { bg: 'bg-avatar-6 dark:bg-avatar-6-dark', text: 'text-avatar-6-ink dark:text-avatar-6-ink-dark' },
  { bg: 'bg-avatar-7 dark:bg-avatar-7-dark', text: 'text-avatar-7-ink dark:text-avatar-7-ink-dark' },
  { bg: 'bg-avatar-8 dark:bg-avatar-8-dark', text: 'text-avatar-8-ink dark:text-avatar-8-ink-dark' },
  { bg: 'bg-avatar-9 dark:bg-avatar-9-dark', text: 'text-avatar-9-ink dark:text-avatar-9-ink-dark' },
  { bg: 'bg-avatar-10 dark:bg-avatar-10-dark', text: 'text-avatar-10-ink dark:text-avatar-10-ink-dark' },
];
const BRAND = { bg: 'bg-primary-soft dark:bg-primary-soft-dark', text: 'text-primary dark:text-primary-dark' };

/** A person's colour: their user id hashed (FNV-1a) onto the palette, so it never changes with their name. */
export function avatarColor(id: string | undefined) {
  if (!id) return BRAND;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return AVATAR_COLORS[(h >>> 0) % AVATAR_COLORS.length];
}

const SIZES = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-16 w-16' };
const TEXT = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' };

/** Someone's photo, or their initial while they have none (or it can't load). */
export function Avatar({ id, name, uri, size = 'md' }: Props) {
  if (uri) {
    // Photo URLs are presigned and change on every fetch; cache by the URL's path (the file itself).
    return <Image source={{ uri, cacheKey: uri.split('?')[0] }} className={`rounded-full ${SIZES[size]}`} accessibilityIgnoresInvertColors />;
  }
  // As written ("zaheer" → z), and a whole character, so an emoji isn't cut in half.
  const initial = [...(name?.trim() ?? '')][0] ?? '?';
  const color = avatarColor(id);
  return (
    <View
      className={`items-center justify-center rounded-full ${color.bg} ${SIZES[size]}`}>
      <Text className={`font-semibold ${color.text} ${TEXT[size]}`}>{initial}</Text>
    </View>
  );
}
