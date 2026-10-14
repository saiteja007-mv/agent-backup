// Per-machine settings in ~/.config/agent-backup/config.json. Nothing personal ships with the package.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configDir, HOST, OS, defaultHome } from './platform.js';
import { readJson, writeJson, exists, lockDownFile } from './util.js';

export const DEFAULT_REMOTE = 'agent-backup-gdrive';
const DRIVE_ROOT = `rclone:${DEFAULT_REMOTE}:agent-backup`;

// Where backups can go. "soon" entries are shown in the enroll menu but cannot be picked yet.
export const STORAGE = [
  { key: 'local', label: 'Local folder', note: 'fast; on the same disk it does not survive a dead disk' },
  { key: 'gdrive', label: 'Google Drive', note: 'off-site, encrypted' },
  { key: 'both', label: 'Local + Google Drive copy', note: 'fast local restores plus an off-site copy' },
  { key: 'onedrive', label: 'OneDrive', soon: true },
  { key: 'icloud', label: 'iCloud Drive (Mac)', soon: true },
];

export const DEFAULT_LOCAL_ROOT = '~/agent-backups';

// Point repository, copy target and fleet list at the chosen storage. Same layout everywhere:
// <root>/<machine> is the repository, <root>/_fleet the fleet list.
export function applyStorage(cfg, storage, localRoot = DEFAULT_LOCAL_ROOT, copyTo) {
  const s = STORAGE.find((x) => x.key === storage);
  if (!s) throw new Error(`storage must be local, gdrive or both (got "${storage}")`);
  if (s.soon) throw new Error(`${s.label} is coming in a future release; use local, gdrive or both for now`);
  cfg.storage = storage;
  if (storage === 'gdrive') {
    cfg.repository = `${DRIVE_ROOT}/${cfg.host}`;
    cfg.registry = `${DRIVE_ROOT}/_fleet`;
    cfg.copyTo = null;
    return cfg;
  }
  const root = path.resolve(String(localRoot).replace(/^~(?=$|[\\/])/, cfg.home));
  cfg.localRoot = root;
  cfg.repository = path.join(root, cfg.host);
  cfg.copyTo = storage === 'both' ? (copyTo || `${DRIVE_ROOT}/${cfg.host}`) : null;
  cfg.registry = storage === 'both' && !copyTo ? `${DRIVE_ROOT}/_fleet` : path.join(root, '_fleet');
  return cfg;
}

export function defaults(dir = configDir()) {
  return {
    version: 1,
    host: HOST,
    os: OS,
    home: defaultHome(),
    storage: 'gdrive',
    repository: `${DRIVE_ROOT}/${HOST}`,
    copyTo: null,
    registry: `${DRIVE_ROOT}/_fleet`,
    passwordFile: path.join(dir, 'password'),
    slackWebhookFile: path.join(dir, 'slack-webhook'),
    binaries: {},
    schedule: { time: OS === 'windows' ? '03:30' : '03:00', selftest: true, watchdog: false, staleHours: 30 },
    retention: { daily: 7, weekly: 4, monthly: 6 },
    components: { disabled: [], options: {} },
    custom: [],
    ignoreDevices: [],
  };
}

export function configPath(dir = configDir()) { return path.join(dir, 'config.json'); }

export function loadConfig({ required = false } = {}) {
  const dir = configDir();
  const file = configPath(dir);
  const saved = readJson(file);
  if (!saved && required) {
    throw new Error(`not enrolled yet: ${file} is missing. Run "agent-backup enroll" first.`);
  }
  const d = defaults(dir);
  const cfg = { ...d, ...(saved || {}) };
  cfg.schedule = { ...d.schedule, ...(saved?.schedule || {}) };
  cfg.retention = { ...d.retention, ...(saved?.retention || {}) };
  cfg.components = { ...d.components, ...(saved?.components || {}) };
  cfg.binaries = { ...(saved?.binaries || {}) };
  // 0.1.0 configs had no storage field. Storage counts as chosen only once enroll --apply recorded it
  // (a config written by "component set" before enrolling holds just the defaults).
  const legacy = Boolean(saved && !saved.storage && saved.repository);
  if (legacy) cfg.storage = String(cfg.repository).startsWith('rclone:') ? 'gdrive' : 'local';
  cfg._storageChosen = Boolean(saved?.enrolled) || legacy;
  cfg._dir = dir;
  cfg._exists = Boolean(saved);
  useOwnRcloneConfig(cfg);
  return cfg;
}

// agent-backup keeps its own rclone config, so terminals, agents (whose AppData may be a sandboxed
// copy, e.g. a Store-packaged app) and the nightly scheduler all see the same Drive sign-in, and your
// other rclone remotes are never touched. Every rclone started from here inherits RCLONE_CONFIG.
function useOwnRcloneConfig(cfg) {
  const own = path.join(cfg._dir, 'rclone.conf');
  process.env.RCLONE_CONFIG = own;
  // Only for an enrolled machine that uses Drive: never copy a sign-in into a config that has not chosen it.
  if (exists(own) || !cfg._storageChosen) return;
  // One time: carry over the remotes an earlier version saved in rclone's default config.
  const names = [cfg.repository, cfg.copyTo, cfg.registry].map((r) => String(r || '')).filter((r) => r.startsWith('rclone:')).map((r) => r.split(':')[1]);
  const def = process.platform === 'win32'
    ? path.join(process.env.APPDATA || '', 'rclone', 'rclone.conf')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'rclone', 'rclone.conf');
  let text = '';
  try { text = pickSections(fs.readFileSync(def, 'utf8'), names); } catch { /* no default config */ }
  if (!text) return;
  fs.writeFileSync(own, text, { mode: 0o600 });
  lockDownFile(own);
}

// The [name] sections of an rclone config whose names are listed.
export function pickSections(text, names) {
  const out = [];
  let keep = false;
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\[(.+)\]\s*$/.exec(line);
    if (m) keep = names.includes(m[1]);
    if (keep) out.push(line);
  }
  return out.length ? `${out.join('\n').trimEnd()}\n` : '';
}

export function saveConfig(cfg) {
  const data = Object.fromEntries(Object.entries(cfg).filter(([k]) => !k.startsWith('_')));
  writeJson(configPath(cfg._dir || configDir()), data);
}

export function hasPassword(cfg) { return exists(cfg.passwordFile) && fs.statSync(cfg.passwordFile).size > 0; }

export function slackWebhook(cfg) {
  if (process.env.AGENT_BACKUP_SLACK_WEBHOOK) return process.env.AGENT_BACKUP_SLACK_WEBHOOK;
  try { return fs.readFileSync(cfg.slackWebhookFile, 'utf8').trim() || null; } catch { return null; }
}
