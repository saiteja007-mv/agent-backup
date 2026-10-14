import test from 'node:test';
import assert from 'node:assert/strict';
import { translateText, homeVariants } from '../lib/xos.js';

const WIN = { os: 'windows', home: 'C:\\Users\\alex' };
const LIN = { os: 'linux', home: '/home/alex' };

test('rewrites every spelling of a Windows home to the Linux home', () => {
  const src = [
    '{"a": "C:\\\\Users\\\\alex\\\\.claude\\\\skills",',
    ' "b": "C:/Users/alex/projects/x",',
    ' "c": "c:\\Users\\alex\\notes.md"}',
  ].join('\n');
  const r = translateText(src, WIN, LIN);
  assert.equal(r.changes, 3);
  assert.match(r.text, /"\/home\/alex\/\.claude\/skills"/);
  assert.match(r.text, /"\/home\/alex\/projects\/x"/);
  assert.match(r.text, /"\/home\/alex\/notes\.md"/);
});

test('rewrites a Linux home to a forward-slash Windows home and flags POSIX-only lines', () => {
  const r = translateText('cwd = "/home/alex/work"\nhook = "bash ~/x.sh"', LIN, WIN);
  assert.equal(r.changes, 1);
  assert.match(r.text, /cwd = "C:\/Users\/alex\/work"/);
  assert.deepEqual(r.attention.map((a) => a.line), [2]);
});

test('flags Windows-only commands when going to Linux', () => {
  const r = translateText('{"command": "powershell -File x.ps1"}\n{"ok": 1}', WIN, LIN);
  assert.equal(r.attention.length, 1);
  assert.equal(r.attention[0].line, 1);
});

test('same machine: nothing changes, nothing flagged', () => {
  const r = translateText('C:\\Users\\alex\\x', WIN, WIN);
  assert.equal(r.changes, 0);
  assert.equal(r.attention.length, 0);
});

test('does not touch a different user whose name starts the same', () => {
  const r = translateText('/home/alexandra/x and /home/alex', LIN, { os: 'linux', home: '/home/sam' });
  assert.equal(r.text, '/home/alexandra/x and /home/sam');
  assert.equal(r.changes, 1);
});

test('homeVariants covers raw, forward-slash and JSON-escaped forms', () => {
  const v = homeVariants('C:\\Users\\alex');
  for (const s of ['C:\\Users\\alex', 'C:/Users/alex', 'C:\\\\Users\\\\alex', 'c:/Users/alex']) assert.ok(v.includes(s), s);
});
