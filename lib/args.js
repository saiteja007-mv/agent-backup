// Tiny argument parser: `cmd pos... --flag --key value --key=value`. Repeated keys become arrays.
export function parseArgs(argv, bools = new Set()) {
  const pos = [];
  const opts = {};
  const put = (k, v) => { opts[k] = k in opts ? [].concat(opts[k], v) : v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) put(key, a.slice(eq + 1));
      else if (bools.has(key)) put(key, true);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) put(key, argv[++i]);
      else put(key, true);
    } else if (a === '-h') put('help', true);
    else if (a === '-v') put('version', true);
    else pos.push(a);
  }
  return { cmd: pos[0], pos: pos.slice(1), opts };
}

// "--only a,b --only c" -> ['a', 'b', 'c']
export function list(v) {
  if (v == null || v === true) return [];
  return [].concat(v).flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
}
