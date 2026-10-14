// The full component catalog for this machine: built-ins, custom ones, and discovered Docker stacks.
import { AGENTS } from './agents.js';
import { system } from './system.js';
import { SERVICES } from './services.js';
import { customComponents } from './custom.js';
import { discoverStacks, stackFromInfo } from './docker.js';
import path from 'node:path';
import { existingEntries, under } from './common.js';
import { OS } from '../platform.js';
import { list } from '../args.js';

export function makeCtx(cfg, overrides = {}) {
  return {
    cfg,
    home: cfg.home,
    os: OS,
    host: cfg.host,
    options: (id) => cfg.components?.options?.[id] || {},
    ...overrides,
  };
}

export function catalog(ctx, { docker = true } = {}) {
  const list = [...AGENTS, system, ...SERVICES, ...customComponents(ctx.cfg)];
  if (docker) list.push(...discoverStacks(ctx));
  const seen = new Set();
  return list.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
}

// Built-in excludes plus your own (components.options.<id>.exclude): names and globs apply anywhere,
// relative paths like "skills/big-tool" apply under each of the component's folders.
export function excludesOf(c, ctx) {
  const out = [...c.excludes(ctx)];
  for (const x of list(ctx.options(c.id).exclude)) {
    if (/[\\/]/.test(x) && !path.isAbsolute(x)) for (const e of existingEntries(c.entries, ctx)) out.push(...under(e.abs, [x]));
    else out.push(x);
  }
  return out;
}

// The component a backup came from, with its restore hooks, even if this machine does not have it.
export function forRestore(ctx, meta) {
  if (meta.kind === 'docker' && meta.info) return stackFromInfo(meta.info, ctx);
  const c = catalog(ctx, { docker: false }).find((x) => x.id === meta.id);
  return c || { id: meta.id, title: meta.title, kind: meta.kind, crossOS: meta.crossOS, entries: [] };
}

// Components that exist here and are not disabled. `only` limits the run to named ids.
export function active(ctx, only = []) {
  const all = catalog(ctx);
  if (only.length) {
    const unknown = only.filter((id) => !all.some((c) => c.id === id));
    if (unknown.length) throw new Error(`unknown component(s): ${unknown.join(', ')}. See "agent-backup scan".`);
  }
  const disabled = new Set(ctx.cfg.components?.disabled || []);
  return all.filter((c) => {
    if (only.length && !only.includes(c.id)) return false;
    if (!only.length && disabled.has(c.id)) return false;
    try { return c.detect(ctx); } catch { return false; }
  });
}
