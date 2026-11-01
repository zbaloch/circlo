import { Image } from 'expo-image';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';

type Props = { name?: string; uri?: string | null; size?: 'sm' | 'md' | 'lg' };

const SIZES = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-16 w-16' };
const TEXT = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' };

/** Someone's photo, or their initial while they have none (or it can't load). */
export function Avatar({ name, uri, size = 'md' }: Props) {
  if (uri) {
    // Photo URLs are presigned and change on every fetch; cache by the URL's path (the file itself).
    return <Image source={{ uri, cacheKey: uri.split('?')[0] }} className={`rounded-full ${SIZES[size]}`} accessibilityIgnoresInvertColors />;
  }
  // As written ("zaheer" → z), and a whole character, so an emoji isn't cut in half.
  const initial = [...(name?.trim() ?? '')][0] ?? '?';
  return (
    <View
      className={`items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark ${SIZES[size]}`}>
      <Text className={`font-semibold text-primary dark:text-primary-dark ${TEXT[size]}`}>{initial}</Text>
    </View>
  );
}
