import { Platform } from 'react-native';

/**
 * Accessibility props for an SVG: an image with a label, or hidden when decorative. On web react-native-svg writes its
 * props straight onto the <svg> element, so React Native's `accessible` would become an invalid DOM attribute (React
 * warns "Received `false` for a non-boolean attribute"); use ARIA there instead.
 */
export function svgA11y(label: string | undefined, os: string = Platform.OS): Record<string, unknown> {
  if (os === 'web') return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return label ? { accessible: true, accessibilityRole: 'image', accessibilityLabel: label } : { accessible: false };
}
