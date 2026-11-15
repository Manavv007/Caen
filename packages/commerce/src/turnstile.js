/**
 * Cloudflare Turnstile (bot check) verification for checkout.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * @param {string} secret - TURNSTILE_SECRET_KEY
 * @param {unknown} token - the widget's response token from the browser
 * @param {string|null} ip - CF-Connecting-IP, optional
 * @returns {Promise<boolean>}
 */
export async function verifyTurnstile(secret, token, ip, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new URLSearchParams({ secret, response: token });
  if (ip) form.set('remoteip', ip);
  try {
    const res = await fetchImpl(SITEVERIFY, { method: 'POST', body: form });
    if (!res.ok) return false;
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}
