// The root navigator needs Reanimated's native runtime, so it can't render under jest-expo. Its guards must name
// where to go: the app opens at "/" (Home, signed-in only), and without redirectTo a signed-out user gets
// expo-router's "Unmatched Route" page instead of Welcome.
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs');
// Jest runs from app/ (package.json), so paths are relative to it.

describe('root navigator guards', () => {
  const source = readFileSync('src/app/_layout.tsx', 'utf8');

  it('sends signed-out users to Welcome', () => {
    expect(source).toMatch(/<Stack\.Protected guard=\{signedIn\} redirectTo="\/welcome">/);
  });

  it('sends signed-in users on an onboarding screen to Home', () => {
    expect(source).toMatch(/<Stack\.Protected guard=\{!signedIn\} redirectTo="\/">/);
  });
});
