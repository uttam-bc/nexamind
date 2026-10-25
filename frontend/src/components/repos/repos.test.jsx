import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash } from '../CodeWorkspace';
import { parsePatch } from './DiffView';
import { highlightLines, isExcluded, looksSecret } from './repoUtils';
import { prepareEntries } from './uploads';

describe('repository routes', () => {
  it('round-trips views, numbers, refs and paths through the URL hash', () => {
    const routes = [
      { repoId: 'r1', view: 'code', ref: 'feature/x', path: 'src/app.js', kind: 'blob' },
      { repoId: 'r1', view: 'pull', number: 12 },
      { repoId: 'r1', view: 'issue', number: 3 },
      { repoId: 'r1', view: 'commit', sha: 'abc1234' },
      { repoId: 'r1', view: 'newpull', source: 'fix', target: 'main' },
    ];
    for (const route of routes) {
      const parsed = parseRoute(routeHash(route));
      for (const [key, value] of Object.entries(route)) expect(parsed[key]).toEqual(value);
    }
    expect(parseRoute('#/code').repoId).toBeNull();
    expect(parseRoute('#/documents').repoId).toBeNull();
  });
});

describe('diffs', () => {
  it('numbers old and new lines of a unified patch', () => {
    const rows = parsePatch('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c');
    expect(rows.map((r) => [r.type, r.oldNo, r.newNo])).toEqual([
      ['hunk', undefined, undefined], ['ctx', 1, 1], ['del', 2, undefined], ['add', undefined, 2], ['ctx', 3, 3],
    ]);
  });
});

describe('highlighting', () => {
  it('keeps one self-contained line per source line and escapes markup', () => {
    const lines = highlightLines('const a = "<b>";\n/* one\ntwo */\n', 'x.js');
    expect(lines).toHaveLength(3);
    expect(lines[0]).not.toContain('<b>');
    lines.forEach((html) => expect((html.match(/<span/g) || []).length).toBe((html.match(/<\/span>/g) || []).length));
  });
});

describe('folder import review', () => {
  it('strips the chosen folder, leaves out dependencies and flags secrets', () => {
    const file = (name, path, size = 3) => Object.assign(new File(['abc'.slice(0, size)], name), { relativePath: path });
    const { root, entries } = prepareEntries([
      file('index.js', 'site/index.js'),
      file('.env', 'site/.env'),
      file('.env.example', 'site/.env.example'),
      file('lib.js', 'site/node_modules/lib/lib.js'),
      file('id_rsa', 'site/keys/id_rsa'),
    ]);
    expect(root).toBe('site');
    const by = Object.fromEntries(entries.map((e) => [e.path, e]));
    expect(by['index.js'].excluded || by['index.js'].secret).toBe(false);
    expect(by['.env'].secret).toBe(true);
    expect(by['.env.example'].secret).toBe(false);
    expect(by['node_modules/lib/lib.js'].excluded).toBe(true);
    expect(by['keys/id_rsa'].secret).toBe(true);
    expect(isExcluded('a/.git/config')).toBe(true);
    expect(looksSecret('config/prod.pem')).toBe(true);
  });
});
