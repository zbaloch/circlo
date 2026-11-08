import config from '../../app.config';

// Jest runs in Node; the app has no Node type definitions, so the few bits used here are declared.
declare const __dirname: string;
declare function require(name: string): unknown;
const fs = require('fs') as { readFileSync(p: string, enc: 'utf8'): string; existsSync(p: string): boolean };
const path = require('path') as { join(...parts: string[]): string };

/**
 * Links to the web app (https://app.hellocirclo.com/…, as in the daily and security emails) open the app when it's
 * installed, on the same screen, and the web app otherwise (owner decision 2026-11-08). Every web page is an app
 * screen, so the whole domain is claimed, and anything added later is covered too. The web app publishes the two
 * files that prove the app belongs to it (public/.well-known).
 */
const WEB_APP = 'app.hellocirclo.com';
const root = path.join(__dirname, '..', '..');
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

type Component = { '/': string; exclude?: boolean };
/** Apple's matching for `components`: the first pattern that matches decides (`*` any run of characters). */
function opensApp(components: Component[], urlPath: string): boolean {
  for (const c of components) {
    const re = new RegExp(`^${c['/'].split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if (re.test(urlPath)) return !c.exclude;
  }
  return false;
}

// The pages the server's emails link to (DailyDigests, SecurityAlerts), and screens a link may well point at later.
const EMAIL_PATHS = ['/notifications', '/settings', '/'];
const LATER = ['/post/abc', '/chat/abc', '/friend/abc', '/settings/notifications'];

describe('web app links open the app', () => {
  it('iPhone: the app claims the web app’s domain, alongside invite links', () => {
    expect(config.ios?.associatedDomains).toEqual(expect.arrayContaining(['applinks:www.hellocirclo.com', `applinks:${WEB_APP}`]));
  });

  it('Android: the app claims every link on the web app’s domain, verified', () => {
    const filter = config.android?.intentFilters?.find((f) => f.data && [f.data].flat().some((d) => d.host === WEB_APP));
    expect(filter).toBeDefined();
    expect(filter?.autoVerify).toBe(true);
    expect(filter?.category).toEqual(expect.arrayContaining(['BROWSABLE', 'DEFAULT']));
    const data = [filter!.data!].flat().find((d) => d.host === WEB_APP)!;
    expect(data.scheme).toBe('https');
    // No path limit: every page, now and later.
    expect(data.pathPrefix ?? data.pathPattern ?? data.path).toBeUndefined();
  });

  it('the web app publishes apple-app-site-association for this app, covering every page but its own files', () => {
    const aasa = read('public/.well-known/apple-app-site-association');
    const detail = aasa.applinks.details[0];
    expect(detail.appIDs).toEqual([`P9273YDUQ9.${config.ios?.bundleIdentifier}`]);
    for (const p of [...EMAIL_PATHS, ...LATER]) expect(opensApp(detail.components, p)).toBe(true);
    for (const p of ['/.well-known/assetlinks.json', '/_expo/static/js/web/entry.js', '/assets/images/icon.png']) expect(opensApp(detail.components, p)).toBe(false);
  });

  it('the web app publishes assetlinks.json for this app, with its signing keys', () => {
    const [link] = read('public/.well-known/assetlinks.json');
    expect(link.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(link.target.package_name).toBe(config.android?.package);
    expect(link.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    for (const f of link.target.sha256_cert_fingerprints) expect(f).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it('Vercel serves apple-app-site-association as JSON', () => {
    const vercel = read('vercel.json');
    const rule = vercel.headers.find((h: { source: string }) => h.source === '/.well-known/apple-app-site-association');
    expect(rule.headers).toEqual(expect.arrayContaining([{ key: 'Content-Type', value: 'application/json' }]));
  });

  it('every page the emails link to is a screen in the app', () => {
    const screens: Record<string, string[]> = {
      '/notifications': ['src/app/(drawer)/(tabs)/notifications.tsx'],
      '/settings': ['src/app/settings/index.tsx'],
      '/': ['src/app/(drawer)/(tabs)/index.tsx'],
    };
    for (const p of EMAIL_PATHS) expect(screens[p].some((f) => fs.existsSync(path.join(root, f)))).toBe(true);
  });
});
