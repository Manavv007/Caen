import { getSession, currentUser, rest, signOut, loginUrl, authEnabled } from './auth.js';
import { readCatalog, formatInr, optionsText, esc } from './cart-lines.js';
import { reportError } from './error-report.js';

const $ = (id) => document.getElementById(id);
const catalog = readCatalog();
const site = JSON.parse($('site-config').textContent);

const STATUS = {
  paid: ['Paid', 'bg-emerald-50 text-emerald-800'],
  pending: ['Awaiting payment', 'bg-amber-50 text-amber-800'],
  needs_review: ['Being reviewed', 'bg-amber-50 text-amber-800'],
  cancelled: ['Cancelled', 'bg-neutral-100 text-neutral-600'],
  refunded: ['Refunded', 'bg-neutral-100 text-neutral-600'],
};
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

async function boot() {
  if (!authEnabled() || !(await getSession())) {
    location.replace(loginUrl('/account'));
    return;
  }
  const user = currentUser();
  $('acct-email').textContent = user.email;
  $('acct-loading').classList.add('hidden');
  $('acct').classList.remove('hidden');
  initTabs();
  loadProfile(user);
  loadOrders();
  loadWishlist();
}

// ---------------------------------------------------------------- tabs
function initTabs() {
  const tabs = ['orders', 'wishlist', 'profile'];
  const select = (name) => {
    for (const t of tabs) {
      $(`tab-${t}`).setAttribute('aria-selected', String(t === name));
      $(`panel-${t}`).classList.toggle('hidden', t !== name);
    }
    history.replaceState(null, '', `#${name}`);
  };
  for (const t of tabs) $(`tab-${t}`).addEventListener('click', () => select(t));
  const fromHash = location.hash.slice(1);
  select(tabs.includes(fromHash) ? fromHash : 'orders');
}

// ---------------------------------------------------------------- orders
function skeleton(n, cls) {
  return Array.from({ length: n }, () => `<div class="animate-pulse rounded-xl bg-cream ${cls}"></div>`).join('');
}

async function loadOrders() {
  const list = $('orders-list');
  list.innerHTML = skeleton(2, 'h-40');
  try {
    const orders = await rest('orders?select=order_number,status,total_inr,shipping_inr,created_at,city,order_items(sku,name,qty,options,line_total_inr)&order=created_at.desc&limit=50');
    // Unpaid checkouts that were never completed aren't real orders for the customer.
    const shown = orders.filter((o) => o.status !== 'pending' || Date.now() - new Date(o.created_at) < 86400000);
    $('orders-empty').classList.toggle('hidden', shown.length > 0);
    list.innerHTML = shown.map(renderOrder).join('');
  } catch (err) {
    list.innerHTML = `<p class="text-[14px] text-red-700">Couldn't load your orders. Please refresh.</p>`;
    reportError('error', err);
  }
}

function renderOrder(o) {
  const [label, cls] = STATUS[o.status] || [o.status, 'bg-neutral-100 text-neutral-600'];
  const items = o.order_items.map((i) => {
    const p = catalog.products[i.sku];
    const img = p ? `<img src="${esc(p.image)}" alt="" class="h-14 w-14 rounded object-cover bg-cream" loading="lazy" referrerpolicy="no-referrer">` : '<div class="h-14 w-14 rounded bg-cream"></div>';
    const name = p ? `<a href="${esc(p.url)}" class="hover:underline">${esc(i.name)}</a>` : esc(i.name);
    return `<li class="flex items-center gap-3">${img}<div class="flex-1"><p class="text-[14px]">${name} × ${i.qty}</p><p class="text-[12px] text-subtle">${esc(optionsText(i.options))}</p></div><span class="text-[14px]">${formatInr(i.line_total_inr)}</span></li>`;
  }).join('');
  const help = `https://wa.me/${site.whatsapp}?text=${encodeURIComponent(`Hi, I have a question about order #${o.order_number}.`)}`;
  return `<article class="rounded-xl border border-line p-5">
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
      <div><p class="font-medium">Order #${esc(o.order_number)}</p><p class="text-[12px] text-subtle">${dateFmt.format(new Date(o.created_at))}${o.city ? ` · to ${esc(o.city)}` : ''}</p></div>
      <span class="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${cls}">${esc(label)}</span>
    </header>
    <ul class="space-y-3 py-4">${items}</ul>
    <footer class="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[14px]">
      <a href="${esc(help)}" target="_blank" rel="noopener" class="text-[13px] text-muted underline underline-offset-2">Need help with this order?</a>
      <span>Total <strong>${formatInr(o.total_inr)}</strong></span>
    </footer>
  </article>`;
}

// ---------------------------------------------------------------- wishlist
async function loadWishlist() {
  const grid = $('wishlist-grid');
  grid.innerHTML = skeleton(4, 'aspect-[3/4]');
  try {
    const rows = await rest('wishlist?select=sku&order=created_at.desc');
    const items = rows.map((r) => ({ sku: r.sku, p: catalog.products[r.sku] })).filter((x) => x.p); // hidden products drop out
    $('wishlist-empty').classList.toggle('hidden', items.length > 0);
    grid.innerHTML = items.map(({ sku, p }) => `
      <div class="flex flex-col overflow-hidden rounded-lg border border-line" data-sku="${esc(sku)}">
        <a href="${esc(p.url)}" class="aspect-square overflow-hidden bg-cream"><img src="${esc(p.image)}" alt="" class="h-full w-full object-cover" loading="lazy" referrerpolicy="no-referrer"></a>
        <div class="flex flex-1 flex-col p-3">
          <a href="${esc(p.url)}" class="font-garamond text-[18px] leading-tight hover:underline">${esc(p.name)}</a>
          <p class="mt-1 text-[14px] font-semibold">${formatInr(p.priceInr)}</p>
          <div class="mt-auto flex gap-2 pt-3">
            <a href="${esc(p.url)}" class="flex-1 rounded bg-ink px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-ink-soft">Choose options</a>
            <button type="button" data-remove class="rounded border border-line px-2 py-2 text-[11px] uppercase tracking-wider hover:border-ink" aria-label="Remove ${esc(p.name)} from wishlist">Remove</button>
          </div>
        </div>
      </div>`).join('');
  } catch (err) {
    grid.innerHTML = `<p class="text-[14px] text-red-700">Couldn't load your wishlist. Please refresh.</p>`;
    reportError('error', err);
  }
}

$('wishlist-grid').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-sku]');
  if (!card) return;
  const sku = card.dataset.sku;
  if (e.target.closest('[data-remove]')) {
    card.style.opacity = '0.4';
    try {
      await rest(`wishlist?sku=eq.${encodeURIComponent(sku)}`, { method: 'DELETE' });
      card.remove();
      if (!$('wishlist-grid').children.length) $('wishlist-empty').classList.remove('hidden');
    } catch {
      card.style.opacity = '';
    }
  }
});

// ---------------------------------------------------------------- profile
const PROFILE_FIELDS = ['full_name', 'phone', 'address1', 'address2', 'city', 'state', 'pincode'];

async function loadProfile(user) {
  const form = $('profile-form');
  try {
    const [p] = await rest('profiles?select=*');
    const values = p || { full_name: user.name };
    for (const k of PROFILE_FIELDS) if (values[k]) form.elements[k].value = values[k];
    const first = (values.full_name || '').split(' ')[0];
    $('acct-name').textContent = first ? `, ${first}` : '';
  } catch (err) {
    reportError('error', err);
  }
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const status = $('profile-status');
  const data = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, form.elements[k].value.trim()]));
  if (data.phone && !/^[6-9]\d{9}$/.test(data.phone)) { status.textContent = 'Enter a valid 10-digit mobile number.'; status.className = 'text-[13px] text-red-700'; return; }
  if (data.pincode && !/^[1-9]\d{5}$/.test(data.pincode)) { status.textContent = 'Enter a valid 6-digit PIN code.'; status.className = 'text-[13px] text-red-700'; return; }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await rest('profiles?on_conflict=user_id', { method: 'POST', body: [{ user_id: currentUser().id, ...data }], prefer: 'resolution=merge-duplicates,return=minimal' });
    status.textContent = 'Saved.';
    status.className = 'text-[13px] text-emerald-700';
    const first = data.full_name.split(' ')[0];
    $('acct-name').textContent = first ? `, ${first}` : '';
  } catch (err) {
    status.textContent = "Couldn't save. Please try again.";
    status.className = 'text-[13px] text-red-700';
    reportError('error', err);
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------- sign out / delete
$('sign-out').addEventListener('click', async () => {
  await signOut();
  location.href = '/';
});

$('delete-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('delete-status');
  if ($('delete-confirm').value.trim() !== 'DELETE') { status.textContent = 'Type DELETE (in capitals) to confirm.'; return; }
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  status.textContent = '';
  try {
    const s = await getSession();
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not delete the account.');
    await signOut();
    location.href = '/?account=deleted';
  } catch (err) {
    status.textContent = err.message;
    btn.disabled = false;
  }
});

boot();
