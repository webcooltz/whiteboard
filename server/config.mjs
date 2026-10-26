import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
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
