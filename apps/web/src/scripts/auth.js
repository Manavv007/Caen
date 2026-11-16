/**
 * Customer sign-in, a small client for Supabase Auth (GoTrue REST API):
 * email one-time code or sign-in link, and Google (OAuth with PKCE). No SDK.
 *
 * The sign-in email carries a 6-digit code and/or a one-time link, depending
 * on the email template (Supabase's built-in sender only allows its default
 * template, which has just the link). Both work: the code is typed on
 * /account/login, the link lands on /account/callback with the session in
 * the URL fragment (#access_token=...), so it also works when the email is
 * opened on another device.
 *
 * Config (public URL + anon key) is embedded in every page by Base.astro as
 * <script type="application/json" id="auth-config">. Without it (local
 * build with no database) accounts are disabled: authEnabled() is false.
 *
 * The session lives in localStorage (like the official SDK) and is refreshed
 * shortly before it expires.
 */
const KEY = 'caen.auth.v1';
const PKCE_KEY = 'caen.auth.pkce';
const NEXT_KEY = 'caen.auth.next';

let config;
function cfg() {
  if (config !== undefined) return config;
  try {
    const el = document.getElementById('auth-config');
    config = el ? JSON.parse(el.textContent) : null;
    if (config && !(config.url && config.anonKey)) config = null;
  } catch {
    config = null;
  }
  return config;
}

export const authEnabled = () => !!cfg();

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && s.access_token && s.refresh_token ? s : null;
  } catch {
    return null;
  }
}

function write(session) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: session lasts for this page only
  }
  window.dispatchEvent(new CustomEvent('auth:change', { detail: session ? session.user : null }));
}

/** Stores a GoTrue token response. */
function save(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user.id, email: (data.user.email || '').toLowerCase(), name: (data.user.user_metadata && (data.user.user_metadata.full_name || data.user.user_metadata.name)) || '' },
  };
  write(session);
  return session;
}

async function gotrue(path, { method = 'POST', body, token } = {}) {
  const c = cfg();
  if (!c) throw new Error('Accounts are not available yet.');
  const res = await fetch(`${c.url}/auth/v1/${path}`, {
    method,
    headers: { apikey: c.anonKey, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // empty body
  }
  if (!res.ok) {
    const msg = (data && (data.msg || data.error_description || data.message)) || `Request failed (${res.status})`;
    const err = new Error(friendly(msg, res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Turns GoTrue messages into something a shopper understands. */
function friendly(msg, status) {
  if (status === 429 || /rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/expired|invalid/i.test(msg) && /token|otp|code/i.test(msg)) return 'That code is wrong or has expired. Check the latest email, or send a new code.';
  if (/sending|smtp|email/i.test(msg) && status >= 500) return "We couldn't send the email right now. Please try again in a few minutes.";
  if (/signups? not allowed/i.test(msg)) return 'New accounts are not open right now.';
  return msg;
}

/**
 * Step 1: email a one-time code / sign-in link (creates the account on first
 * sign-in). The link returns to /account/callback, then to `next`.
 */
export function sendCode(email, next = '/account') {
  try {
    localStorage.setItem(NEXT_KEY, safeNext(next));
  } catch {
    // no storage: the link lands on /account
  }
  const redirect = encodeURIComponent(`${location.origin}/account/callback`);
  return gotrue(`otp?redirect_to=${redirect}`, { body: { email: email.trim().toLowerCase(), create_user: true } });
}

/** Step 2: verify the code; signs in. */
export async function verifyCode(email, code) {
  const data = await gotrue('verify', { body: { type: 'email', email: email.trim().toLowerCase(), token: code.trim() } });
  return save(data);
}

/** Which sign-in methods are switched on in Supabase (Google needs keys). */
export async function providers() {
  try {
    const s = await gotrue('settings', { method: 'GET' });
    return { google: !!(s.external && s.external.google) };
  } catch {
    return { google: false };
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Sends the browser to Google; it comes back to /account/callback. */
export async function signInWithGoogle(next = '/account') {
  const c = cfg();
  if (!c) throw new Error('Accounts are not available yet.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, next: safeNext(next) }));
  const redirect = `${location.origin}/account/callback`;
  location.href = `${c.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256`;
}

/** True when this URL carries the result of an email sign-in link (session or error). */
export const hasLinkResult = (hash = location.hash) => /[#&](access_token|error_code|error)=/.test(hash);

/** Error from a sign-in link or OAuth redirect, in shopper terms. */
function linkError(p) {
  const code = p.get('error_code') || '';
  const desc = p.get('error_description') || p.get('error') || '';
  if (/otp_expired/.test(code) || /expired|invalid/i.test(desc)) {
    return 'This sign-in link has expired or was already used. Each link works once: tap “Try again” for a new one.';
  }
  return desc.replace(/\+/g, ' ');
}

/**
 * On /account/callback: finish signing in, from an email link (session in
 * the #fragment) or from Google (?code=, PKCE).
 * @returns {Promise<string>} where to go next
 */
export async function completeSignIn(url = location) {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const query = new URLSearchParams(url.search);
  // The fragment holds tokens: drop it from the address bar and history now.
  if (url.hash) history.replaceState(null, '', url.pathname + url.search);

  if (hash.get('access_token') || hash.get('error') || hash.get('error_code')) {
    if (!hash.get('access_token')) throw new Error(linkError(hash));
    const token = hash.get('access_token');
    const user = await gotrue('user', { method: 'GET', token });
    save({
      access_token: token,
      refresh_token: hash.get('refresh_token'),
      expires_at: Number(hash.get('expires_at')) || undefined,
      expires_in: Number(hash.get('expires_in')) || 3600,
      user,
    });
    let next = '/account';
    try {
      next = safeNext(localStorage.getItem(NEXT_KEY) || '/account');
      localStorage.removeItem(NEXT_KEY);
    } catch {
      // ignore
    }
    return next;
  }

  if (query.get('error') || query.get('error_description')) throw new Error(linkError(query));
  const code = query.get('code');
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
  } catch {
    // ignore
  }
  sessionStorage.removeItem(PKCE_KEY);
  if (!code || !saved) throw new Error('Sign-in was interrupted. Please try again.');
  const data = await gotrue('token?grant_type=pkce', { body: { auth_code: code, code_verifier: saved.verifier } });
  save(data);
  return saved.next;
}

let refreshing = null;
/** Current session (refreshed if it expires within a minute), or null. */
export async function getSession() {
  const s = read();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  if (!refreshing) {
    refreshing = gotrue('token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })
      .then(save)
      .catch((e) => {
        if (e.status && e.status < 500) write(null); // refresh token revoked/expired: signed out
        return null;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Signed-in user from storage, without network (for instant UI). */
export const currentUser = () => (read() || {}).user || null;

export async function signOut() {
  const s = read();
  write(null);
  if (s) gotrue('logout', { token: s.access_token }).catch(() => {});
}

/** Calls the Supabase REST API as the signed-in customer (row-level security applies). */
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const c = cfg();
  const s = await getSession();
  if (!c || !s) {
    const e = new Error('Please sign in again.');
    e.status = 401;
    throw e;
  }
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: c.anonKey,
      authorization: `Bearer ${s.access_token}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) write(null);
  if (!res.ok) {
    const e = new Error(`Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Only same-site paths are allowed as post-login destinations. */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/account';
}

export const loginUrl = (next = location.pathname + location.search) => `/account/login?next=${encodeURIComponent(safeNext(next))}`;

/** Calls fn now and on every sign-in/sign-out (this tab or another). */
export function onAuthChange(fn) {
  fn(currentUser());
  window.addEventListener('auth:change', (e) => fn(e.detail));
  window.addEventListener('storage', (e) => { if (e.key === KEY) fn(currentUser()); });
}
