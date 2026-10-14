import test from 'node:test';
import assert from 'node:assert/strict';
import { statusLine, fmtDur } from '../lib/progress.js';
import { pickSections } from '../lib/config.js';

const now = Date.parse('2026-10-14T03:00:00Z');

test('fmtDur', () => {
  assert.equal(fmtDur(9), '9s');
  assert.equal(fmtDur(75), '1m 15s');
  assert.equal(fmtDur(3725), '1h 02m');
  assert.equal(fmtDur(null), '');
});

test('status line while uploading: percent, sizes, speed, files, time left, current file', () => {
  const line = statusLine({
    index: 2, total: 8, component: 'codex', phase: 'backing up', percent: 0.453,
    bytesDone: 1.2 * 1024 ** 3, totalBytes: 2.6 * 1024 ** 3, speed: 18.3 * 1024 ** 2,
    filesDone: 2301, totalFiles: 5120, eta: 130, current: 'C:\\Users\\a\\.codex\\sessions\\2026\\x.jsonl',
  }, now);
  assert.equal(line, '[2/8] codex   45%  1.2 GB / 2.6 GB  18 MB/s  2,301/5,120 files  ~2m 10s left  2026/x.jsonl');
});

test('status line before restic reports totals, and for other phases', () => {
  assert.match(statusLine({ index: 1, total: 3, component: 'claude', phase: 'backing up', bytesDone: 0, phaseStartedAt: now - 4000 }, now),
    /^\[1\/3\] claude: scanning files\.\.\. 0 B read, 4s$/);
  assert.equal(statusLine({ index: 0, component: 'final steps', phase: 'copying new snapshots to Google Drive', phaseStartedAt: now - 65000 }, now),
    'final steps: copying new snapshots to Google Drive... 1m 05s');
});

test('pickSections copies only the named rclone remotes', () => {
  const conf = '[mine]\ntype = s3\n\n[agent-backup-gdrive]\ntype = drive\nscope = drive.file\ntoken = x\n\n[other]\ntype = sftp\n';
  assert.equal(pickSections(conf, ['agent-backup-gdrive']), '[agent-backup-gdrive]\ntype = drive\nscope = drive.file\ntoken = x\n');
  assert.equal(pickSections(conf, ['absent']), '');
});

test('setSection replaces one rclone remote and keeps the others', async () => {
  const { setSection } = await import('../lib/config.js');
  const conf = '[mine]\ntype = s3\n\n[agent-backup-gdrive]\ntype = drive\nscope = drive.file\n';
  const out = setSection(conf, 'agent-backup-gdrive', { type: 'drive', client_id: 'x', client_secret: '', scope: 'drive.file', token: '{"a":1}' });
  assert.equal(out, '[mine]\ntype = s3\n\n[agent-backup-gdrive]\ntype = drive\nclient_id = x\nscope = drive.file\ntoken = {"a":1}\n');
  assert.equal(setSection('', 'r', { type: 'drive' }), '[r]\ntype = drive\n');
});
