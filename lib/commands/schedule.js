// agentvault schedule install | remove | show
import { loadConfig, saveConfig } from '../config.js';
import { install, remove, describe } from '../schedule.js';
import { execBase } from '../app.js';

export default async function schedule(o, pos) {
  const action = pos[0] || 'show';
  if (action === 'show') { console.log(describe() || 'No agentvault jobs installed.'); return 0; }
  if (action === 'remove') { const r = remove(); console.log(r.length ? `Removed: ${r.join(', ')}` : 'Nothing to remove.'); return 0; }
  if (action !== 'install') throw new Error('usage: agentvault schedule install|remove|show');
  const cfg = loadConfig({ required: true });
  if (o.time) {
    if (!/^\d{1,2}:\d{2}$/.test(String(o.time))) throw new Error('--time must look like 03:00');
    cfg.schedule.time = String(o.time);
    saveConfig(cfg);
  }
  const jobs = ['backup', ...(cfg.schedule.selftest ? ['selftest'] : []), ...(cfg.schedule.watchdog ? ['watchdog'] : [])];
  const done = install(cfg, execBase(cfg), jobs);
  for (const d of done) console.log(d.ok ? `${d.job}: ${d.where}` : `${d.job}: ${d.error}`);
  return done.every((d) => d.ok) ? 0 : 1;
}
