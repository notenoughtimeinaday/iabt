import { hashPassword, normalizeEmail } from './security.js';

// Administrative CLI only; no public bypass or owner-email registration rule.
export async function recoverOwner({ repository, email, password }) {
  const owner = await repository.findUserByEmail(normalizeEmail(email));
  if (!owner || owner.role !== 'admin') throw Object.assign(new Error('Recovery requires an existing administrator account'), { code: 'existing_admin_required' });
  const passwordHash = await hashPassword(password);
  await repository.updatePassword(owner.id, passwordHash);
  await repository.appendAudit(owner, 'auth.owner_recovery', { source: 'operator_cli', sessions_revoked: true });
  return { recovered: true, user_id: owner.id };
}
