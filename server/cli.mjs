// node server/cli.mjs add-user <name> | remove-user <name> | list-users | hash-password
import { createInterface } from 'node:readline';
import { loadConfig } from './config.mjs';
import { hashPassword, cleanName } from './auth.mjs';
import { loadUsers, saveUsers } from './users.mjs';
import { mkdirSync } from 'node:fs';

const config = loadConfig();
const [cmd, arg] = process.argv.slice(2);

function ask(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); }; // hide typing
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}

async function readPassword() {
  if (process.env.NEW_PASSWORD) return process.env.NEW_PASSWORD;
  const a = await ask('Password: ');
  const b = await ask('Repeat password: ');
  if (a !== b) { console.error('Passwords do not match.'); process.exit(1); }
  return a;
}

mkdirSync(config.dataDir, { recursive: true });
if (cmd === 'add-user') {
  const name = cleanName(arg);
  if (!name) { console.error('Usage: add-user <name>   (letters, numbers, spaces . _ - ; max 24)'); process.exit(1); }
  const pw = await readPassword();
  if (pw.length < 8) { console.error('Use at least 8 characters.'); process.exit(1); }
  const users = loadUsers(config.dataDir) || {};
  users[name] = await hashPassword(pw);
  saveUsers(config.dataDir, users);
  console.log(`Saved user "${name}". Restart the server to apply.`);
} else if (cmd === 'remove-user') {
  const users = loadUsers(config.dataDir) || {};
  const key = Object.keys(users).find((n) => n.toLowerCase() === String(arg).toLowerCase());
  if (!key) { console.error('No such user.'); process.exit(1); }
  delete users[key];
  saveUsers(config.dataDir, users);
  console.log(`Removed "${key}". Restart the server to apply.`);
} else if (cmd === 'list-users') {
  console.log(Object.keys(loadUsers(config.dataDir) || {}).join('\n') || '(no users: shared-password mode)');
} else if (cmd === 'hash-password') {
  console.log(await hashPassword(await readPassword()));
} else {
  console.error('Commands: add-user <name> | remove-user <name> | list-users | hash-password');
  process.exit(1);
}
