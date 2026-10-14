import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { overlay, newStats } from '../lib/overlay.js';

function tree(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
}

test('overlay writes restored files, saves what it overwrites, keeps live-only files, rewrites paths', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'av-overlay-'));
  const src = path.join(t, 'src');
  const dst = path.join(t, 'dst');
  const safety = path.join(t, 'safety');
  tree(src, {
    'settings.json': '{"dir": "C:\\\\Users\\\\alex\\\\.claude\\\\skills"}',
    'same.txt': 'identical',
    'sub/new.md': 'brand new',
    'image.png': Buffer.from([0, 1, 2, 3]),
  });
  tree(dst, { 'settings.json': '{"dir": "old"}', 'same.txt': 'identical', 'cache/keep.bin': 'live only' });

  const stats = newStats();
  const xlate = { from: { os: 'windows', home: 'C:\\Users\\alex' }, to: { os: 'linux', home: '/home/alex' } };
  overlay(src, dst, { safetyRoot: safety, xlate, stats, chown: false });

  assert.equal(fs.readFileSync(path.join(dst, 'settings.json'), 'utf8'), '{"dir": "/home/alex/.claude/skills"}');
  assert.equal(fs.readFileSync(path.join(dst, 'sub/new.md'), 'utf8'), 'brand new');
  assert.equal(fs.readFileSync(path.join(dst, 'cache/keep.bin'), 'utf8'), 'live only');
  assert.deepEqual([...fs.readFileSync(path.join(dst, 'image.png'))], [0, 1, 2, 3]);
  assert.equal(stats.written, 3);
  assert.equal(stats.unchanged, 1);
  assert.equal(stats.saved, 1);
  assert.equal(stats.rewrites, 1);

  const savedCopy = fs.readdirSync(safety, { recursive: true }).find((f) => String(f).endsWith('settings.json'));
  assert.ok(savedCopy, 'previous settings.json was saved aside');
  assert.equal(fs.readFileSync(path.join(safety, savedCopy), 'utf8'), '{"dir": "old"}');

  // A second run changes nothing.
  const again = newStats();
  overlay(src, dst, { safetyRoot: safety, xlate, stats: again, chown: false });
  assert.equal(again.written, 0);
  assert.equal(again.unchanged, 4);
  fs.rmSync(t, { recursive: true, force: true });
});
