// Slack incoming-webhook messages. A missing webhook is not an error: messages are just skipped.
import { slackWebhook } from './config.js';

export async function slack(cfg, text) {
  const url = slackWebhook(cfg);
  if (!url) return { ok: false, skipped: true };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
