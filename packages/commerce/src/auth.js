/**
 * Customer sign-in (Supabase Auth). The browser sends its access token as
 * `Authorization: Bearer <token>`; the server asks Supabase who it belongs to.
 */

/**
 * @returns {Promise<{id: string, email: string}|null>} null for guests or invalid/expired tokens
 */
export async function getUserFromRequest(request, env, fetchImpl = fetch) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 4096 || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u && u.id ? { id: u.id, email: (u.email || '').toLowerCase() } : null;
  } catch {
    return null;
  }
}

/** Deletes a user (admin API). Their profile/wishlist cascade; orders keep, unlinked. */
export async function deleteUser(env, userId, fetchImpl = fetch) {
  const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`delete user: HTTP ${res.status} ${await res.text()}`);
}
