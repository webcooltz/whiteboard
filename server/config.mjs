import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** KEY=value lines from an env file (# comments, optional quotes). Real environment variables win. */
export function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

// The project's .env (or the file named by ENV_FILE), under the real environment.
const withEnvFile = (env) => ({ ...readEnvFile(resolve(env.ENV_FILE || join(root, '.env'))), ...env });

export function loadConfig(env = withEnvFile(process.env)) {
  const dataDir = resolve(env.DATA_DIR || join(root, 'data'));
  const deviceKeys = {};
  for (const pair of (env.BOARD_DEVICE_KEYS || '').split(',')) {
    const i = pair.indexOf('=');
    if (i > 0 && pair.length - i - 1 >= 16) deviceKeys[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return {
    root,
    port: +env.PORT || 8080,
    host: env.HOST || '0.0.0.0',
    dataDir,
    webRoot: resolve(env.WEB_ROOT || join(root, 'dist', 'whiteboard')),
    password: env.BOARD_PASSWORD || '',
    passwordHash: env.BOARD_PASSWORD_HASH || '',
    secret: env.BOARD_SECRET || '',
    deviceKeys,
    trustProxy: env.TRUST_PROXY === '1',
    tokenTtlMs: 30 * 24 * 3600_000,
  };
}
