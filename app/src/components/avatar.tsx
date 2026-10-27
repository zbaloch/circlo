import { Image } from 'expo-image';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';

type Props = { name?: string; uri?: string; size?: 'sm' | 'md' | 'lg' };

const SIZES = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-16 w-16' };
const TEXT = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' };

/** Avatar from a local decrypted file URI, or initials. Never loads remote plaintext images. */
export function Avatar({ name, uri, size = 'md' }: Props) {
  if (uri) {
    return <Image source={{ uri }} className={`rounded-full ${SIZES[size]}`} accessibilityIgnoresInvertColors />;
  }
  const initial = name?.trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      className={`items-center justify-center rounded-full bg-primary-soft dark:bg-primary-soft-dark ${SIZES[size]}`}>
      <Text className={`font-semibold text-primary dark:text-primary-dark ${TEXT[size]}`}>{initial}</Text>
    </View>
  );
}
