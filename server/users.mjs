// Optional per-user passwords (data/users.json). If present, logins must name a real user,
// so the audit log records verified identities rather than self-declared names.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export function usersFile(dataDir) { return join(dataDir, 'users.json'); }

export function loadUsers(dataDir) {
  const f = usersFile(dataDir);
  if (!existsSync(f)) return null;
  try {
    const u = JSON.parse(readFileSync(f, 'utf8'));
    return u && typeof u === 'object' && Object.keys(u).length ? u : null;
  } catch { return null; }
}

export function saveUsers(dataDir, users) {
  const f = usersFile(dataDir);
  writeFileSync(f + '.tmp', JSON.stringify(users, null, 2), { mode: 0o600 });
  renameSync(f + '.tmp', f);
}
