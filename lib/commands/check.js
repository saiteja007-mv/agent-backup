// agentvault check: verify the repository. Default reads 5% of the data; --full reads all of it.
import { loadConfig } from '../config.js';
import { Restic } from '../restic.js';

export default async function check(o) {
  const cfg = loadConfig({ required: true });
  const restic = new Restic(cfg);
  console.log(o.full ? 'Reading every byte of the backup (downloads all of it)...' : 'Checking structure and 5% of the data...');
  const r = o.full ? restic.exec(['check', '--read-data']) : restic.check('5%');
  console.log(`${r.stdout}${r.stderr}`.trim().split('\n').slice(-8).join('\n'));
  console.log(r.ok ? '\nRepository is healthy.' : '\nRepository check FAILED.');
  return r.ok ? 0 : 1;
}
