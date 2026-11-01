// NativeWind maps className on Reanimated's Animated.View on phones but not on the web, where the classes are dropped
// (Home's floating header lost `absolute top-0` and sat under the list). Classes go on a plain View inside or around it.
const fs = jest.requireActual<{
  readdirSync: (path: string, options: { recursive: true }) => string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
}>('fs');

// Jest runs from app/ (package.json); Windows lists paths with backslashes (character 92).
const files = fs
  .readdirSync('src', { recursive: true })
  .map((f) => 'src/' + f.split(String.fromCharCode(92)).join('/'))
  .filter((f) => f.endsWith('.tsx') && !f.includes('__tests__'));

describe("Reanimated's Animated.View", () => {
  it('never carries className', () => {
    const offenders = files.filter((f) => {
      const source = fs.readFileSync(f, 'utf8');
      return source.includes("from 'react-native-reanimated'") && /<Animated\.View\b[^>]*\bclassName=/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
