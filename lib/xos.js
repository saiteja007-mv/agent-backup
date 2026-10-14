// Cross-OS restore for agent configs: rewrite the source home to the target home inside text
// config files, and list lines that only make sense on the source OS. Pure functions, unit tested.

const PATH_TAIL = String.raw`(?:[\\/]+[^\s"'\`<>|,;)\]}]*)*`;
// The home must end there: /home/alex must not match /home/alexandra.
const HOME_END = String.raw`(?=[\\/\s"'\`<>|,;)\]}]|$)`;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Every spelling a home path can take inside a file.
export function homeVariants(home) {
  const v = new Set([home]);
  if (/^[A-Za-z]:\\/.test(home)) {
    const fwd = home.replace(/\\/g, '/');
    const esc = home.replace(/\\/g, '\\\\');
    for (const h of [home, fwd, esc]) { v.add(h); v.add(h[0].toLowerCase() + h.slice(1)); v.add(h[0].toUpperCase() + h.slice(1)); }
  }
  return [...v].sort((a, b) => b.length - a.length);
}

// Target home in forward-slash form: Windows accepts C:/Users/x/... in nearly every tool and it needs no escaping.
export function targetHome(home) { return home.replace(/\\/g, '/'); }

const WIN_ONLY = /\bcmd(\.exe)?\s+\/[ck]\b|\bpowershell(\.exe)?\b|\bpwsh(\.exe)?\b|\.exe\b|\.cmd\b|\.bat\b|\b[A-Za-z]:[\\/]/i;
// No ':' before the slash, so a rewritten C:/Users/... path is not flagged.
const POSIX_ONLY = /(^|[\s"'=(])\/(usr|opt|etc|var|home|bin|sbin|snap|srv|Users)\/|\.sh\b|\bbash\b|\bsudo\b/;

export function translateText(text, from, to) {
  let changes = 0;
  const repl = targetHome(to.home);
  let out = text;
  if (from.home !== to.home || from.os !== to.os) {
    for (const v of homeVariants(from.home)) {
      const re = new RegExp(escapeRe(v) + HOME_END + `(${PATH_TAIL})`, 'g');
      out = out.replace(re, (_, tail) => {
        changes++;
        return repl + tail.replace(/\\\\/g, '/').replace(/\\/g, '/');
      });
    }
  }
  const attention = [];
  if (from.os !== to.os) {
    const rule = to.os === 'windows' ? POSIX_ONLY : WIN_ONLY;
    out.split('\n').forEach((line, i) => {
      if (rule.test(line)) attention.push({ line: i + 1, text: line.trim().slice(0, 160) });
    });
  }
  return { text: out, changes, attention };
}

export const TEXT_EXT = new Set(['.json', '.jsonc', '.toml', '.yaml', '.yml', '.md', '.ini', '.conf', '.cfg', '.env', '.txt', '.js', '.mjs', '.ts', '.sh', '.ps1']);
