import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { test } from './fixtures.ts';

describe('backend API through nginx', () => {
  test('signed-out callers get 401 on owner and read routes', async ({ app }) => {
    for (const path of ['/api/v1/state', '/api/v1/dashboard', '/api/v1/products']) {
      const res = await fetch(new URL(path, app.baseUrl));
      expect(res.status).toBe(401);
    }
  });

  test('a wrong password is rejected and shown on the sign-in form', async ({ app, screen }) => {
    await app.open('/');
    await screen.getByLabel('Email').fill('chushop.rakuma@gmail.com');
    await screen.getByLabel('Mật khẩu').fill('definitely-not-the-password');
    await screen.getByRole('button', 'Đăng nhập').tap();
    await expect(screen.getByRole('alert')).toBeVisible();
    await expect(screen.getByRole('heading', 'Đăng nhập')).toBeVisible();
  });

  test('owner session reads state and dashboard', { session: 'owner' }, async ({ app, api }) => {
    await app.open('/');
    const state = await api('/api/v1/state');
    expect(state.status).toBe(200);
    const body = await state.json();
    expect(Array.isArray(body.products)).toBe(true);

    const dash = await (await api('/api/v1/dashboard')).json();
    expect(dash.period.status).toBe('OPEN');
    expect(dash.totals.totalProfit).toBe(dash.totals.totalRevenue - dash.totals.totalCost); // BR-12
  });

  test('server validates writes (price must be > 0)', { session: 'owner' }, async ({ app, api }) => {
    await app.open('/');
    const res = await api('/api/v1/purchases', { method: 'POST', json: { productId: '1', price: 0, qty: 1 } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).errors.price).toBeTruthy();
  });

  test('a read API key can read but not write (AC-04)', { session: 'owner' }, async ({ app, api }) => {
    await app.open('/');
    const created = await (await api('/api/v1/api-keys', { method: 'POST', json: { name: `e2e-read-${Date.now()}`, scope: 'read' } })).json();
    const auth = { authorization: `Bearer ${created.key}` };
    try {
      expect((await fetch(new URL('/api/v1/stock', app.baseUrl), { headers: auth })).status).toBe(200);
      const write = await fetch(new URL('/api/v1/products', app.baseUrl), {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'should not exist' }),
      });
      expect(write.status).toBe(403);
      expect((await fetch(new URL('/api/v1/state', app.baseUrl), { headers: auth })).status).toBe(403);
    } finally {
      await api(`/api/v1/api-keys/${created.record.id}/revoke`, { method: 'POST' });
    }
    expect((await fetch(new URL('/api/v1/stock', app.baseUrl), { headers: auth })).status).toBe(401);
  });
});
