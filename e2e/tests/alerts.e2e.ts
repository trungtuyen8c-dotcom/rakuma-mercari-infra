import { expect } from 'e2e';
import { test } from './fixtures.ts';

// Owner requests 2026-10-11: warnings that cost money or reputation when missed, gathered in "Việc hôm nay".
test('Rakuma to-do sections and Việc hôm nay: payment due, delivered not received, slow seller', { session: 'owner' }, async ({ app, screen, api, browser }) => {
  await app.open('/');
  const id = Date.now().toString(36);
  const dash = await (await api('/api/v1/dashboard')).json();
  const key = await (await api('/api/v1/api-keys', { method: 'POST', json: { name: `e2e-alerts-${id}`, scope: 'write' } })).json();
  const jst = new Date(Date.now() + 9 * 3600e3 + 5 * 3600e3); // Japan time, 5 hours from now
  const pad = (n: number) => String(n).padStart(2, '0');
  const due = `${pad(jst.getUTCMonth() + 1)}/${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
  const fiveDaysAgo = new Date(Date.now() + 9 * 3600e3 - 5 * 864e5).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() + 9 * 3600e3 - 864e5).toISOString().slice(0, 10);
  const order = (no: string, status: string, extra = {}) => ({ orderNo: no + id, link: `https://item.fril.jp/${no.toLowerCase()}${id}`,
    title: `E2E ${no}`, status, price: 20000, seller: `shop${no}-${id}`, chatOpen: true, ...extra });
  const links = ['p', 'r', 's', 'w', 'x'].map(n => `https://item.fril.jp/${n}${id}`);
  try {
    const res = await fetch(new URL('/api/v1/rakuma/sync', app.baseUrl), {
      method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orders: [
        order('P', `支払い (期限 ${due})`),
        order('R', '商品の受取 (発送済み 10/08, 配達済み)', { date: dash.period.start, tracking: `TR${id}` }),
        order('S', '商品の受取', { date: fiveDaysAgo }),
        order('W', '商品発送待ち', { date: yesterday }),
        order('X', '商品の受取 (発送済み 10/08, 配達済み)', { date: dash.period.start, tracking: `TX${id}` }),
      ] }),
    });
    expect(res.status).toBe(200);
    // The owner deleted row X: its order no longer raises alerts
    const rowX = ((await (await api('/api/v1/purchases')).json()) as any[]).find(p => p.link === links[4]);
    await api(`/api/v1/purchases/${rowX.id}`, { method: 'DELETE' });

    await app.open('/#dashboard');
    await browser.reload();
    const today = screen.getByRole('region', 'Việc hôm nay');
    await expect(today).toContainText('đơn sắp hết hạn thanh toán');
    await expect(today).toContainText('đơn đã giao tới, chưa bấm nhận hàng');
    await expect(today).toContainText('đơn shop chưa gửi sau 3 ngày');

    await app.open('/#rakuma');
    const item = (list: string, shop: string) => screen.getByRole('list', list).getByRole('listitem').filter({ hasText: shop });
    const pay = item('Đơn sắp hết hạn thanh toán', `shopP-${id}`);
    await expect(pay).toContainText(/còn [45] giờ/);
    await expect(pay.getByRole('link', 'Mở giao dịch ↗')).toHaveAttribute('href', `https://fril.jp/transaction?item_id=p${id}`);
    await expect(item('Đơn đã giao, chưa nhận hàng', `shopR-${id}`)).toBeVisible();
    await expect(item('Đơn đã giao, chưa nhận hàng', `shopX-${id}`)).toHaveCount(0);
    // Every paid order not shipped yet is listed with its wait; 3 days or more is slow
    await expect(item('Đơn shop chưa gửi hàng', `shopW-${id}`)).toContainText('chờ 1 ngày');
    await expect(item('Đơn shop chưa gửi hàng', `shopW-${id}`)).not.toContainText('chậm');
    const slow = item('Đơn shop chưa gửi hàng', `shopS-${id}`);
    await expect(slow).toContainText('chờ 5 ngày · chậm');
    await expect(slow.getByRole('link', 'Mở giao dịch ↗')).toHaveAttribute('href', `https://fril.jp/transaction?item_id=s${id}`);
  } finally {
    for (const p of ((await (await api('/api/v1/purchases')).json()) as any[]).filter(p => links.includes(p.link))) {
      await api(`/api/v1/purchases/${p.id}`, { method: 'DELETE' });
    }
    await api(`/api/v1/api-keys/${key.record.id}/revoke`, { method: 'POST' });
  }
});

test('odd purchase price is flagged; editing in the dialog keeps the filter; selling below cost warns', { session: 'owner' }, async ({ app, screen, api, browser }) => {
  await app.open('/');
  const id = Date.now().toString(36);
  const dash = await (await api('/api/v1/dashboard')).json();
  const name = `E2E odd ${id}`;
  const product = await (await api('/api/v1/products', { method: 'POST', json: { name } })).json();
  const rows: string[] = [];
  try {
    for (const price of [10000, 10000, 10500, 25000]) {
      const r = await (await api('/api/v1/purchases', { method: 'POST', json: { productId: product.id, price, qty: 1, date: dash.period.start, note: `odd-${id}` } })).json();
      rows.push(r.id);
    }
    await app.open('/#purchases');
    await browser.reload();
    await expect(screen.getByRole('region', 'Cảnh báo nhập hàng')).toContainText('dòng giá nhập lệch nhiều');
    await screen.getByRole('button', /^Xem \d+ dòng giá lệch nhiều$/).tap();
    const odd = screen.getByRole('region', 'Bảng nhập hàng').getByRole('row').filter({ hasText: name });
    await expect(odd).toHaveCount(1);
    await expect(odd).toContainText('giá lệch nhiều');

    // Sửa opens a dialog over the list; closing it keeps the filter and the row in place
    await odd.getByRole('button', /^Sửa dòng/).tap();
    const dialog = screen.getByRole('dialog', /^Sửa dòng/);
    await expect(dialog.getByLabel('Giá nhập mỗi cái (¥) *')).toHaveValue('25000');
    await dialog.getByRole('button', 'Đóng').tap();
    await expect(dialog).toBeHidden();
    await expect(screen.getByRole('combobox', 'Trạng thái')).toHaveValue('oddprice');
    await expect(odd).toBeVisible();
    await screen.getByRole('button', 'Bỏ lọc, xem tất cả').tap();
    await expect(screen.getByRole('combobox', 'Trạng thái')).toHaveValue('all');

    // Sale below the usual cost per item (median 10.250¥) is flagged under the price
    await app.open('/#sales');
    await screen.getByRole('button', 'Thêm đơn bán').tap();
    await screen.getByLabel('Sản phẩm *').selectOption({ label: name });
    await screen.getByLabel('Đơn giá mỗi cái (¥) *').fill('9000');
    await expect(screen.getByText(/Bán lỗ: còn 9\.000¥\/cái sau ship, giá nhập thường 10\.250¥\/cái/)).toBeVisible();
  } finally {
    for (const r of rows) await api(`/api/v1/purchases/${r}`, { method: 'DELETE' });
    await api(`/api/v1/products/${product.id}`, { method: 'DELETE' });
  }
});
