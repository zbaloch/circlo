// On the web, SafeAreaView sets its own padding from the (zero) safe-area insets, which overrides padding classes on
// it: content then touches the edges of the web column. Padding goes on a view inside it instead.
const fs = jest.requireActual<{
  readdirSync: (path: string, options: { recursive: true }) => string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
}>('fs');

// Jest runs from app/ (package.json), so paths are relative to it.
const files = fs
  .readdirSync('src', { recursive: true })
  // Windows lists paths with backslashes (character 92).
  .map((f) => 'src/' + f.split(String.fromCharCode(92)).join('/'))
  .filter((f) => f.endsWith('.tsx') && !f.includes('__tests__'));

describe('SafeAreaView', () => {
  it('never carries padding classes', () => {
    const offenders = files.flatMap((f) =>
      [...fs.readFileSync(f, 'utf8').matchAll(/<SafeAreaView[^>]*className="([^"]*)"/g)]
        .filter((m) => /(^|\s)p[xytblr]?-/.test(m[1]))
        .map(() => f),
    );
    expect(offenders).toEqual([]);
  });
});
