import { readFile } from 'node:fs/promises';
import { createRepository } from './repository-factory.js';
import { loadConfig } from './config.js';
import { recoverOwner } from './owner-recovery.js';

// Supply a private password file, never credentials in command arguments/logs.
const [email, passwordFile] = process.argv.slice(2);
if (!email || !passwordFile) throw new Error('Usage: node src/owner-recovery-main.js EMAIL PRIVATE_PASSWORD_FILE');
const repository = await createRepository(loadConfig());
try {
  await recoverOwner({ repository, email, password: (await readFile(passwordFile, 'utf8')).trimEnd() });
  console.log('Owner recovery completed; previous sessions revoked.');
} finally { await repository.close?.(); }
