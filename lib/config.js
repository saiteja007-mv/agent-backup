// Per-machine settings in ~/.config/agentvault/config.json. Nothing personal ships with the package.
import fs from 'node:fs';
import path from 'node:path';
import { configDir, HOST, OS, defaultHome } from './platform.js';
import { readJson, writeJson, exists } from './util.js';

export const DEFAULT_REMOTE = 'agentvault-gdrive';

export function defaults(dir = configDir()) {
  return {
    version: 1,
    host: HOST,
    os: OS,
    home: defaultHome(),
    repository: `rclone:${DEFAULT_REMOTE}:AgentVault/${HOST}`,
    registry: `rclone:${DEFAULT_REMOTE}:AgentVault/_fleet`,
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
    throw new Error(`not enrolled yet: ${file} is missing. Run "agentvault enroll" first.`);
  }
  const d = defaults(dir);
  const cfg = { ...d, ...(saved || {}) };
  cfg.schedule = { ...d.schedule, ...(saved?.schedule || {}) };
  cfg.retention = { ...d.retention, ...(saved?.retention || {}) };
  cfg.components = { ...d.components, ...(saved?.components || {}) };
  cfg.binaries = { ...(saved?.binaries || {}) };
  cfg._dir = dir;
  cfg._exists = Boolean(saved);
  return cfg;
}

export function saveConfig(cfg) {
  const { _dir, _exists, ...data } = cfg;
  writeJson(configPath(_dir || configDir()), data);
}

export function hasPassword(cfg) { return exists(cfg.passwordFile) && fs.statSync(cfg.passwordFile).size > 0; }

export function slackWebhook(cfg) {
  if (process.env.AGENTVAULT_SLACK_WEBHOOK) return process.env.AGENTVAULT_SLACK_WEBHOOK;
  try { return fs.readFileSync(cfg.slackWebhookFile, 'utf8').trim() || null; } catch { return null; }
}
