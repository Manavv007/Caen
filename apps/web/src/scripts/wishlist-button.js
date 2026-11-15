import { authEnabled, currentUser, rest, loginUrl } from './auth.js';

/** "Save to wishlist" toggle on the product page. */
export async function initWishlistButton(btn) {
  if (!btn) return;
  if (!authEnabled()) { btn.classList.add('hidden'); return; }
  const sku = btn.dataset.sku;
  let saved = false;
  const render = () => {
    btn.setAttribute('aria-pressed', String(saved));
    btn.querySelector('[data-wish-off]').classList.toggle('hidden', saved);
    btn.querySelector('[data-wish-on]').classList.toggle('hidden', !saved);
    btn.querySelector('[data-wish-label]').textContent = saved ? 'Saved to wishlist' : 'Save to wishlist';
  };
  if (currentUser()) {
    try {
      saved = (await rest(`wishlist?select=sku&sku=eq.${encodeURIComponent(sku)}`)).length > 0;
      render();
    } catch {
      // signed out or offline: keep the default state
    }
  }
  btn.addEventListener('click', async () => {
    if (!currentUser()) { location.href = loginUrl(); return; }
    const was = saved;
    saved = !saved; // optimistic
    render();
    try {
      if (saved) await rest('wishlist', { method: 'POST', body: [{ user_id: currentUser().id, sku }], prefer: 'resolution=ignore-duplicates,return=minimal' });
      else await rest(`wishlist?sku=eq.${encodeURIComponent(sku)}`, { method: 'DELETE' });
    } catch (err) {
      saved = was;
      render();
      if (err.status === 401) location.href = loginUrl();
    }
  });
}
