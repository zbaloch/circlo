// Android draws apps edge to edge, under its navigation bar. With the three-button bar (still common, especially on
// older phones) the end of a screen was hidden behind ◁ ○ ☰. Screens with the standard header keep clear of it with
// bottom padding the size of the bar (0 where there is none); screens that handle it themselves (tabs, the thread,
// chat, full-screen ones) must not get it twice.
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs');

describe('keeping clear of the Android navigation bar', () => {
  const root = readFileSync('src/app/_layout.tsx', 'utf8');
  const options = (name: string) => root.match(new RegExp(`<Stack\\.Screen name="${name.replace(/[[\]/]/g, '\\$&')}" options=\\{([^}]*\\}?[^}]*)\\}`))?.[1] ?? '';

  it('pads screens with the standard header by the bar’s height', () => {
    expect(root).toMatch(/paddingBottom: insets\.bottom/);
    for (const name of ['profile', 'circles', 'devices', 'settings/index', 'settings/account', 'settings/notifications', 'settings/privacy',
      'settings/about', 'edit-profile', 'friend/[id]', 'scan', 'circle/[n]', 'preview/[id]', 'new-message', 'report/[id]', 'change-password']) {
      expect([name, options(name)]).toEqual([name, expect.stringMatching(/^page\(/)]);
    }
  });

  it('leaves alone the screens that already keep clear of it', () => {
    for (const name of ['(drawer)', 'post/[id]', 'chat/[id]', 'compose', 'reply/[id]', 'viewer', 'security-alert', 'enable-notifications', 'intro']) {
      expect([name, options(name)]).toEqual([name, expect.not.stringMatching(/^page\(/)]);
    }
  });

  it('pads the sign-up and log-in screens too, but not the intro (it keeps clear itself)', () => {
    const auth = readFileSync('src/app/(auth)/_layout.tsx', 'utf8');
    expect(auth).toMatch(/paddingBottom: insets\.bottom/);
    expect(auth).toMatch(/<Stack\.Screen name="welcome" options=\{\{ headerShown: false, contentStyle: \{ backgroundColor: palette\.surface \} \}\} \/>/);
  });
});
