// agentvault component list | enable <id> | disable <id> | add <id> <path...> | add <id> --command "<cmd>"
//                     | remove <id> | set <id> key=value...
import path from 'node:path';
import { loadConfig, saveConfig } from '../config.js';
import { makeCtx, catalog } from '../components/index.js';
import { table } from '../util.js';
import { list } from '../args.js';

function value(v) {
  if (v === 'true' || v === 'false') return v === 'true';
  return v.includes(',') ? v.split(',').map((s) => s.trim()).filter(Boolean) : v;
}

export default async function component(o, pos) {
  const cfg = loadConfig();
  const [action = 'list', id, ...rest] = pos;
  const needId = () => { if (!id) throw new Error(`usage: agentvault component ${action} <id>`); };
  const disabled = new Set(cfg.components.disabled);

  if (action === 'list') {
    const ctx = makeCtx(cfg);
    const rows = catalog(ctx).map((c) => {
      let found = false;
      try { found = c.detect(ctx); } catch { /* absent */ }
      return [c.id, c.kind, found ? 'found' : '-', disabled.has(c.id) ? 'disabled' : '', c.title];
    });
    console.log(table(rows, ['id', 'kind', 'here', 'state', 'what']));
    return 0;
  }
  needId();
  if (action === 'disable') disabled.add(id);
  else if (action === 'enable') disabled.delete(id);
  else if (action === 'add') {
    const def = o.command
      ? { id, command: String(o.command), ...(o.file ? { file: String(o.file) } : {}) }
      : { id, paths: rest.map((p) => path.resolve(p)), ...(o.exclude ? { exclude: list(o.exclude) } : {}) };
    if (!def.command && !def.paths.length) throw new Error('usage: agentvault component add <id> <path...>  or  --command "<cmd>" [--file name]');
    cfg.custom = [...(cfg.custom || []).filter((c) => c.id !== id), def];
  } else if (action === 'remove') {
    cfg.custom = (cfg.custom || []).filter((c) => c.id !== id);
  } else if (action === 'set') {
    const opts = { ...(cfg.components.options[id] || {}) };
    for (const kv of rest) {
      const i = kv.indexOf('=');
      if (i < 1) throw new Error(`expected key=value, got "${kv}"`);
      opts[kv.slice(0, i)] = value(kv.slice(i + 1));
    }
    cfg.components.options = { ...cfg.components.options, [id]: opts };
  } else {
    throw new Error('usage: agentvault component list|enable|disable|add|remove|set');
  }
  cfg.components.disabled = [...disabled];
  saveConfig(cfg);
  console.log(`Saved (${action} ${id}).`);
  return 0;
}
