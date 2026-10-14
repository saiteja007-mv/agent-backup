// agentvault slack set | test | remove. The webhook is typed hidden and stored readable only by you.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { slack } from '../notify.js';
import { askHidden, mkdirp, lockDownFile } from '../util.js';

export default async function slackCmd(o, pos) {
  const cfg = loadConfig();
  const action = pos[0] || 'test';
  if (action === 'remove') { fs.rmSync(cfg.slackWebhookFile, { force: true }); console.log('Slack messages off.'); return 0; }
  if (action === 'set') {
    if (!process.stdin.isTTY) throw new Error('run "agentvault slack set" in a terminal; the URL is typed, not passed as an argument');
    const url = (await askHidden('Slack incoming webhook URL: ')).trim();
    if (!/^https:\/\/hooks\.slack\.com\//.test(url)) throw new Error('that is not a Slack webhook URL (https://hooks.slack.com/...)');
    mkdirp(path.dirname(cfg.slackWebhookFile), 0o700);
    fs.writeFileSync(cfg.slackWebhookFile, url, { mode: 0o600 });
    lockDownFile(cfg.slackWebhookFile);
    console.log('Saved. Sending a test message...');
  } else if (action !== 'test') {
    throw new Error('usage: agentvault slack set|test|remove');
  }
  const r = await slack(cfg, `agentvault ${cfg.host}: test message`);
  console.log(r.skipped ? 'No webhook set (agentvault slack set).' : r.ok ? 'Sent.' : `Failed: ${r.status || r.error}`);
  return r.ok ? 0 : 1;
}
