// agentvault check: verify the backups (and the copy, if there is one).
// Default reads 5% of the data; --full reads all of it.
import { loadConfig } from '../config.js';
import { Restic } from '../restic.js';

export default async function check(o) {
  const cfg = loadConfig({ required: true });
  let ok = true;
  for (const repo of [cfg.repository, cfg.copyTo].filter(Boolean)) {
    const restic = new Restic({ ...cfg, repository: repo });
    console.log(`\n${repo}\n${o.full ? 'Reading every byte (downloads all of it)...' : 'Checking structure and 5% of the data...'}`);
    const r = o.full ? restic.exec(['check', '--read-data']) : restic.check('5%');
    console.log(`${r.stdout}${r.stderr}`.trim().split('\n').slice(-4).join('\n'));
    console.log(r.ok ? 'Healthy.' : 'Check FAILED.');
    ok &&= r.ok;
  }
  return ok ? 0 : 1;
}
