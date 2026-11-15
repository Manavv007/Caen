import { beforeEach, describe, expect, it } from 'vitest';
import { handleCheckout } from '../src/handlers.js';
import { handleDeleteAccount } from '../src/account.js';
import { FakeBackend } from './fake-backend.js';

const ENV = {
  RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'key-secret',
  SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
};
const CUSTOMER = { name: 'Test Buyer', email: 'buyer@example.com', phone: '9876543210', address1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' };
const req = (path, body, token) => new Request(`https://shop.test${path}`, {
  method: 'POST', body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {},
});

let backend;
beforeEach(() => { backend = new FakeBackend(); });
const checkout = (extra, token) =>
  handleCheckout(req('/api/checkout', { items: [{ sku: 'POINTY-NOSE-RING', qty: 1 }], customer: CUSTOMER, ...extra }, token), ENV, { fetch: backend.fetch });

describe('checkout with an account', () => {
  it('links the order to the signed-in customer', async () => {
    expect((await checkout({}, 'token-a')).status).toBe(200);
    expect(backend.tables.orders[0].user_id).toBe('user-a');
    expect(backend.tables.profiles).toHaveLength(0); // not asked to save
  });

  it('saves the delivery address when asked, and updates it next time', async () => {
    await checkout({ saveAddress: true }, 'token-a');
    expect(backend.tables.profiles).toEqual([expect.objectContaining({ user_id: 'user-a', full_name: 'Test Buyer', pincode: '411001', city: 'Pune' })]);
    await handleCheckout(req('/api/checkout', { items: [{ sku: 'POINTY-NOSE-RING', qty: 1 }], customer: { ...CUSTOMER, city: 'Mumbai', pincode: '400001' }, saveAddress: true }, 'token-a'), ENV, { fetch: backend.fetch });
    expect(backend.tables.profiles).toHaveLength(1);
    expect(backend.tables.profiles[0]).toMatchObject({ city: 'Mumbai', pincode: '400001' });
  });

  it('treats an invalid or expired token as a guest (checkout still works)', async () => {
    expect((await checkout({ saveAddress: true }, 'expired-token')).status).toBe(200);
    expect(backend.tables.orders[0].user_id).toBeNull();
    expect(backend.tables.profiles).toHaveLength(0);
  });

  it('guest checkout is unchanged', async () => {
    expect((await checkout({})).status).toBe(200);
    expect(backend.tables.orders[0].user_id).toBeNull();
  });
});

describe('POST /api/account/delete', () => {
  const del = (body, token) => handleDeleteAccount(req('/api/account/delete', body, token), ENV, { fetch: backend.fetch });

  it('deletes the signed-in account when confirmed', async () => {
    const res = await del({ confirm: 'DELETE' }, 'token-a');
    expect(res.status).toBe(200);
    expect(backend.deletedUsers).toEqual(['user-a']);
  });

  it('requires the explicit confirmation', async () => {
    expect((await del({}, 'token-a')).status).toBe(400);
    expect(backend.deletedUsers).toEqual([]);
  });

  it('requires a valid sign-in', async () => {
    expect((await del({ confirm: 'DELETE' }, 'bad-token')).status).toBe(401);
    expect((await del({ confirm: 'DELETE' })).status).toBe(401);
    expect(backend.deletedUsers).toEqual([]);
  });
});
