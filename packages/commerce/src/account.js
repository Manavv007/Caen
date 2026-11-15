/**
 * POST /api/account/delete  {confirm: "DELETE"}  (Authorization: Bearer <token>)
 * Deletes the signed-in customer's account (DPDP Act: right to erasure).
 * Profile, wishlist and sign-in identities go; orders stay (tax records)
 * but are no longer linked to an account.
 */
import { getUserFromRequest, deleteUser } from './auth.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function handleDeleteAccount(request, env, { fetch: fetchImpl = fetch } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Accounts are not available yet.' }, 503);
  let body = null;
  try {
    body = JSON.parse(await request.text());
  } catch {
    // fall through
  }
  if (!body || body.confirm !== 'DELETE') return json({ error: 'Please confirm account deletion.' }, 400);
  const user = await getUserFromRequest(request, env, fetchImpl);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  try {
    await deleteUser(env, user.id, fetchImpl);
  } catch (err) {
    console.error('account delete failed', err);
    return json({ error: 'Could not delete the account. Please try again or contact us.' }, 502);
  }
  return json({ ok: true });
}
