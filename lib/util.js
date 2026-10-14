// Small shared helpers: process execution, filesystem, prompts, formatting.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// Windows .cmd/.bat shims (npm, pipx...) can only be started through cmd.exe since Node's CVE-2024-27980 fix.
function viaShell(cmd, args, opts) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(cmd)) return [cmd, args, opts];
  const q = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  return [[cmd, ...args].map(q).join(' '), [], { ...opts, shell: true }];
}

export function run(cmd, args = [], opts = {}) {
  [cmd, args, opts] = viaShell(cmd, args, opts);
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    windowsHide: true,
    ...opts,
  });
  return {
    ok: r.status === 0 && !r.error,
    code: r.status,
    stdout: r.stdout || '',
    stderr: (r.stderr || '') + (r.error ? String(r.error.message) : ''),
  };
}

// Run a command and send its stdout to a file (used for dumps that can be large).
export function runToFile(cmd, args, file, opts = {}) {
  [cmd, args, opts] = viaShell(cmd, args, opts);
  return new Promise((resolve) => {
    let p;
    try { p = spawn(cmd, args, { windowsHide: true, ...opts }); } catch (e) {
      resolve({ ok: false, code: -1, stderr: String(e.message) });
      return;
    }
    const out = fs.createWriteStream(file);
    let stderr = '';
    let done = false;
    const finish = (r) => { if (!done) { done = true; out.end(); resolve(r); } };
    out.on('error', (e) => finish({ ok: false, code: -1, stderr: String(e.message) }));
    p.stdout.pipe(out);
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => finish({ ok: false, code: -1, stderr: String(e.message) }));
    // Resolve only after the file is fully written, so callers can read or delete it safely.
    p.on('close', (code) => {
      const r = { ok: code === 0, code, stderr };
      if (out.writableFinished) finish(r); else { out.on('finish', () => finish(r)); out.end(); }
    });
  });
}

export function which(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext.toLowerCase());
      const P = path.join(dir, name + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
      if (fs.existsSync(P) && fs.statSync(P).isFile()) return P;
    }
  }
  return null;
}

export const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

export function mkdirp(p, mode) { fs.mkdirSync(p, { recursive: true, mode }); return p; }

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function writeJson(file, data, mode) {
  mkdirp(path.dirname(file));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode });
  fs.renameSync(tmp, file);
}

// Restrict a file to the current user (Windows has no chmod semantics).
export function lockDownFile(file) {
  if (process.platform === 'win32') {
    const user = process.env.USERNAME;
    run('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`]);
  } else {
    fs.chmodSync(file, 0o600);
  }
}

export function dirSize(root, skip = () => false, budgetMs = 15000) {
  const start = Date.now();
  let bytes = 0;
  let files = 0;
  let partial = false;
  const stack = [root];
  while (stack.length) {
    if (Date.now() - start > budgetMs) { partial = true; break; }
    const p = stack.pop();
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (skip(p)) continue;
    if (st.isDirectory()) {
      let names = [];
      try { names = fs.readdirSync(p); } catch { continue; }
      for (const n of names) stack.push(path.join(p, n));
    } else { bytes += st.size; files += 1; }
  }
  return { bytes, files, partial };
}

export function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtAge(ms) {
  if (ms == null) return 'never';
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(ms / 60000)}m ago`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function table(rows, headers) {
  const all = [headers, ...rows].map((r) => r.map((c) => String(c ?? '')));
  const w = headers.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd();
  return [line(all[0]), line(w.map((n) => '-'.repeat(n))), ...all.slice(1).map(line)].join('\n');
}

export async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(question, res));
  rl.close();
  return answer.trim();
}

export async function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
  const p = new Promise((res) => rl.question(question, res));
  muted = true;
  const answer = await p;
  rl.close();
  process.stdout.write('\n');
  return answer;
}

// Hidden input that may arrive as several lines (a long paste broken by the terminal): reads lines until
// done(text so far) is true, or maxLines lines have come in.
export function askHiddenLines(question, done, maxLines = 40) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  rl._writeToOutput = (s) => { if (!muted) rl.output.write(s); };
  process.stdout.write(question);
  muted = true;
  const lines = [];
  return new Promise((resolve) => {
    rl.on('line', (l) => {
      lines.push(l);
      const text = lines.join('\n');
      if (done(text) || lines.length >= maxLines) { rl.close(); process.stdout.write('\n'); resolve(text); }
    });
    rl.on('close', () => resolve(lines.join('\n')));
  });
}

export async function choose(title, items, fmt = (x) => String(x)) {
  if (!items.length) throw new Error(`nothing to choose for: ${title}`);
  console.log(`\n${title}`);
  items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(it)}`));
  for (;;) {
    const a = await ask(`Choose 1-${items.length}: `);
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1];
  }
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
