import { CameraView } from 'expo-camera';
import { Image } from 'expo-image';
import { VideoView } from 'expo-video';
import { cssInterop } from 'nativewind';
import { Animated } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

// Let third-party components take NativeWind `className` (styling rule: classes, not inline styles).
cssInterop(GestureHandlerRootView, { className: 'style' });
cssInterop(SafeAreaView, { className: 'style' });
cssInterop(Image, { className: 'style' });
cssInterop(CameraView, { className: 'style' });
cssInterop(VideoView, { className: 'style' });
// The spinner and toggle (components/ui) animate with React Native's Animated.
cssInterop(Animated.View, { className: 'style' });
