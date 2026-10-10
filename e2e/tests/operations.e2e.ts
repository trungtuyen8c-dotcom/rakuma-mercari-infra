import { describe } from '@e2e-dev/web';
import { expect } from 'e2e';
import { test } from './fixtures.ts';

type Api = (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const yen = (n: number) => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('vi-VN') + '¥';
const post = async (api: Api, path: string, json: unknown) => {
  const r = await api(path + '?force=true', { method: 'POST', json });
  expect(r.status).toBe(201);
  return r.json();
};
const openPeriod = async (api: Api) => (await (await api('/api/v1/dashboard')).json()).period;
const purchasesOf = async (api: Api, productId: string) =>
  ((await (await api('/api/v1/purchases')).json()) as any[]).filter(r => r.productId === productId);
const salesOf = async (api: Api, productId: string) =>
  ((await (await api('/api/v1/sales')).json()) as any[]).filter(r => r.productId === productId);

// Each test makes its own product (and rows) through the API, then reloads so the SPA picks them up.
async function seedProduct(api: Api, name: string) {
  return post(api, '/api/v1/products', { name });
}

describe('Nhập hàng, Bán hàng, Tồn kho, Sản phẩm, Phân tích', () => {
  test('purchase rows: duplicate link warning + save anyway, tick checked/reviewed, edit, delete (BR-05)', { session: 'owner' }, async ({ app, screen, api, browser }) => {
    await app.open('/');
    const name = `E2E ops ${uid()}`;
    const p = await seedProduct(api, name);
    const link = `https://item.fril.jp/e2e${uid()}`;
    const day = (await openPeriod(api)).start;

    await app.open('/#purchases');
    await browser.reload(); // rows made through the API above; the SPA loads /state once
    for (const qty of ['3', '1']) {
      await screen.getByRole('button', 'Thêm dòng nhập').tap();
      await screen.getByLabel('Sản phẩm *').selectOption({ label: name });
      await screen.getByLabel('Ngày đặt').fill(day);
      await screen.getByLabel('Giá nhập mỗi cái (¥) *').fill('1000');
      await screen.getByLabel('Số lượng *').fill(qty);
      await screen.getByLabel('Link sản phẩm Rakuma/Mercari').fill(link);
      await screen.getByRole('button', 'Lưu dòng nhập').tap();
      if (qty === '1') {
        // Second row with the same link: warning, nothing saved until "Vẫn lưu dòng này"
        await expect(screen.getByRole('alert')).toContainText('Link này đã có ở dòng số');
        expect(await purchasesOf(api, p.id)).toHaveLength(1);
        await screen.getByRole('button', 'Vẫn lưu dòng này').tap();
      }
      await expect.poll(async () => (await purchasesOf(api, p.id)).length).toBe(qty === '3' ? 1 : 2);
    }
    await screen.getByRole('button', 'Đóng').tap();

    const [first, second] = (await purchasesOf(api, p.id)).sort((a, b) => a.stt - b.stt);
    expect(first.dupLink).toBe(true);
    expect(second.dupLink).toBe(true);
    const table = screen.getByRole('region', 'Bảng nhập hàng');
    await expect(table.getByRole('row').filter({ hasText: name }).first()).toContainText('trùng');

    // Tick both status boxes on the first row; each box turns on once the server has saved it and the page reloaded
    for (const label of [`Đã kiểm hàng dòng ${first.stt} (${name})`, `Đã đánh giá người bán dòng ${first.stt} (${name})`]) {
      await table.getByRole('checkbox', label).tap();
      await expect(table.getByRole('checkbox', label)).toBeChecked();
    }
    await expect.poll(async () => (await purchasesOf(api, p.id)).find(r => r.id === first.id)).toMatchObject({ checked: true, reviewed: true });

    // Edit the first row: qty 3 -> 4, total 4000
    await table.getByRole('button', `Sửa dòng ${first.stt} (${name})`).tap();
    await expect(screen.getByRole('heading', new RegExp(`^Sửa dòng ${first.stt} · kỳ`))).toBeVisible();
    await screen.getByLabel('Số lượng *').fill('4');
    await screen.getByRole('button', 'Lưu thay đổi').tap();
    // The row still shares its link with the second one, so the server warns again on edit
    await expect(screen.getByRole('alert')).toContainText('Link này đã có ở dòng số');
    await screen.getByRole('button', 'Vẫn lưu dòng này').tap();
    await expect.poll(async () => (await purchasesOf(api, p.id)).find(r => r.id === first.id).total).toBe(4000);

    // Delete both rows from the table, then the product
    await table.getByRole('button', `Xóa dòng ${second.stt} (${name})`).tap();
    await table.getByRole('button', `Xóa dòng ${first.stt} (${name})`).tap();
    await expect.poll(async () => (await purchasesOf(api, p.id)).length).toBe(0);
    await api(`/api/v1/products/${p.id}`, { method: 'DELETE' });
  });

  test('sales: overselling warns, "Vẫn lưu đơn này" saves, stock goes negative; edit and delete fix it (GD-05)', { session: 'owner' }, async ({ app, screen, api, browser }) => {
    await app.open('/');
    const name = `E2E sell ${uid()}`;
    const p = await seedProduct(api, name);
    const day = (await openPeriod(api)).start;
    const pur = await post(api, '/api/v1/purchases', { productId: p.id, price: 1000, qty: 2, date: day });
    await app.open('/#sales');
    await browser.reload(); // rows made through the API above; the SPA loads /state once

    await screen.getByRole('button', 'Thêm đơn bán').tap();
    await screen.getByLabel('Sản phẩm *').selectOption({ label: name });
    await screen.getByLabel('Ngày bán').fill(day);
    await screen.getByLabel('Số lượng bán *').fill('5');
    await screen.getByLabel('Đơn giá mỗi cái (¥) *').fill('2000');
    await screen.getByRole('button', 'Lưu đơn bán').tap();
    await expect(screen.getByRole('alert')).toContainText(`Chỉ còn 2 cái “${name}”, bạn đang bán 5 cái. Tồn kho sẽ âm 3 cái.`);
    expect(await salesOf(api, p.id)).toHaveLength(0);
    await screen.getByRole('button', 'Vẫn lưu đơn này').tap();
    await expect.poll(async () => (await salesOf(api, p.id)).length).toBe(1);
    await screen.getByRole('button', 'Đóng').tap();

    // Negative stock is flagged on Tồn kho and Tổng quan
    await app.open('/#inventory');
    await expect(screen.getByText(`Sản phẩm “${name}” đang âm 3 cái.`)).toBeVisible();
    await app.open('/#dashboard');
    await expect(screen.getByText(`Sản phẩm “${name}” đang âm 3 cái.`)).toBeVisible();

    // Edit the sale down to 1, the warning disappears
    const [sale] = await salesOf(api, p.id);
    await app.open('/#sales');
    const table = screen.getByRole('region', 'Bảng bán hàng');
    await table.getByRole('button', `Sửa đơn bán ${sale.stt} (${name})`).tap();
    await screen.getByLabel('Số lượng bán *').fill('1');
    await screen.getByRole('button', 'Lưu thay đổi').tap();
    await expect.poll(async () => (await salesOf(api, p.id))[0].total).toBe(2000);
    await app.open('/#inventory');
    await expect(screen.getByText(`Sản phẩm “${name}” đang âm`, { exact: false })).toBeHidden();

    await app.open('/#sales');
    await table.getByRole('button', `Xóa đơn bán ${sale.stt} (${name})`).tap();
    await expect.poll(async () => (await salesOf(api, p.id)).length).toBe(0);
    await api(`/api/v1/purchases/${pur.id}`, { method: 'DELETE' });
    await api(`/api/v1/products/${p.id}`, { method: 'DELETE' });
  });

  test('stock count: typing the counted qty records the difference as Điều chỉnh', { session: 'owner' }, async ({ app, screen, api, browser }) => {
    await app.open('/');
    const name = `E2E count ${uid()}`;
    const p = await seedProduct(api, name);
    await post(api, '/api/v1/purchases', { productId: p.id, price: 500, qty: 5, date: (await openPeriod(api)).start });
    await app.open('/#inventory');
    await browser.reload(); // rows made through the API above; the SPA loads /state once
    await screen.getByRole('searchbox', 'Tìm sản phẩm').fill(name);
    const row = screen.getByRole('region', 'Bảng tồn kho').getByRole('row').filter({ hasText: name });
    const input = row.getByRole('spinbutton');
    await expect(input).toHaveValue('5');
    await input.fill('3');
    await input.press('Enter');
    await expect(row.getByRole('cell').nth(5)).toHaveText('-2');
    await expect(input).toHaveValue('3');
    const stock = (await (await api('/api/v1/stock')).json()).rows.find((r: any) => r.productId === p.id);
    expect(stock).toMatchObject({ incoming: 5, adjust: -2, current: 3 });
  });

  test('products: rename, hide/show, delete only without transactions', { session: 'owner' }, async ({ app, screen, api, browser }) => {
    await app.open('/');
    const id = uid();
    const used = await seedProduct(api, `E2E used ${id}`);
    const spare = await seedProduct(api, `E2E spare ${id}`);
    await post(api, '/api/v1/purchases', { productId: used.id, price: 500, qty: 1, date: (await openPeriod(api)).start });
    await app.open('/#products');
    await browser.reload(); // rows made through the API above; the SPA loads /state once
    const table = screen.getByRole('region', 'Bảng danh mục sản phẩm');

    await table.getByRole('button', `Sửa tên / từ khóa E2E used ${id}`).tap();
    await table.getByRole('textbox', `Tên mới cho E2E used ${id}`).fill(`E2E renamed ${id}`);
    await table.getByRole('textbox', `Tên mới cho E2E used ${id}`).press('Enter');
    await expect(table.getByText(`E2E renamed ${id}`)).toBeVisible();
    // The rename shows everywhere the product appears
    const purchases = await purchasesOf(api, used.id);
    expect(purchases[0].productName).toBe(`E2E renamed ${id}`);

    // Hidden products leave the "add" pickers but keep their history
    await table.getByRole('button', `Ẩn E2E renamed ${id}`).tap();
    await expect(table.getByRole('row').filter({ hasText: `E2E renamed ${id}` })).toContainText('Ẩn');
    await app.open('/#purchases');
    await screen.getByRole('button', 'Thêm dòng nhập').tap();
    await expect(screen.getByLabel('Sản phẩm *').getByRole('option', `E2E renamed ${id}`)).toHaveCount(0);
    await screen.getByRole('button', 'Đóng').tap();
    await app.open('/#products');
    await table.getByRole('button', `Hiện lại E2E renamed ${id}`).tap();
    await expect(table.getByRole('row').filter({ hasText: `E2E renamed ${id}` })).toContainText('Đang dùng');

    // Delete: blocked with transactions (button disabled + server refuses), allowed without
    await expect(table.getByRole('button', `Xóa E2E renamed ${id}`)).toBeDisabled();
    expect((await api(`/api/v1/products/${used.id}`, { method: 'DELETE' })).status).toBeGreaterThanOrEqual(400);
    await table.getByRole('button', `Xóa E2E spare ${id}`).tap();
    await expect(table.getByText(`E2E spare ${id}`)).toBeHidden();

    await api(`/api/v1/purchases/${purchases[0].id}`, { method: 'DELETE' });
    await api(`/api/v1/products/${used.id}`, { method: 'DELETE' });
  });

  test('Phân tích: cost of goods sold is FIFO, oldest purchase first (BR-15)', { session: 'owner' }, async ({ app, screen, api, browser }) => {
    await app.open('/');
    const name = `E2E fifo ${uid()}`;
    const p = await seedProduct(api, name);
    const period = await openPeriod(api);
    const later = period.start.slice(0, 8) + '20';
    // Entered newest first, so FIFO has to sort by date: 2 @ 1000 (old), then 2 @ 1500
    const rows = [
      await post(api, '/api/v1/purchases', { productId: p.id, price: 1500, qty: 2, date: later }),
      await post(api, '/api/v1/purchases', { productId: p.id, price: 1000, qty: 2, date: period.start }),
      await post(api, '/api/v1/sales', { productId: p.id, price: 2000, qty: 3, date: later }),
    ];
    // COGS = 2 x 1000 + 1 x 1500 = 3500; sales 6000; profit 2500
    const an = await (await api(`/api/v1/analysis/products/${p.id}`)).json();
    expect(an).toMatchObject({ soldQty: 3, soldAmount: 6000, inQty: 4, cogs: 3500, profit: 2500, uncovered: 0 });
    expect(an.lots.map((l: any) => [l.unitCost, l.take])).toEqual([[1000, 2], [1500, 1]]);

    await app.open('/#analysis');
    await browser.reload(); // rows made through the API above; the SPA loads /state once
    await screen.getByLabel('Sản phẩm').selectOption({ label: name });
    // Metric cards: Giá vốn hàng đã bán, Tiền bán, Tổng lãi
    for (const value of [yen(3500), yen(6000), yen(2500)]) {
      await expect(screen.getByRole('definition').filter({ hasText: new RegExp(`^${value}$`) })).toBeVisible();
    }
    await expect(screen.getByRole('region', 'Bảng lô tính giá vốn').getByRole('row')).toHaveCount(3);

    await api(`/api/v1/sales/${rows[2].id}`, { method: 'DELETE' });
    for (const r of rows.slice(0, 2)) await api(`/api/v1/purchases/${r.id}`, { method: 'DELETE' });
    await api(`/api/v1/products/${p.id}`, { method: 'DELETE' });
  });

  test('editing a closed month asks first, then later months recompute and history says "Đã sửa sau chốt"', { session: 'owner' }, async ({ app, screen, api, browser }) => {
    await app.open('/');
    const periods: any[] = await (await api('/api/v1/periods')).json();
    const closed = periods.filter(p => p.status === 'CLOSED');
    const target = closed[0]; // oldest closed month
    const after = periods[periods.indexOf(target) + 1];
    const row = ((await (await api('/api/v1/purchases')).json()) as any[]).find(r => r.periodId === target.id);
    const unit = row.price - row.discount;
    const before = (await (await api('/api/v1/dashboard')).json()).totals.totalCost;

    await app.open('/#purchases');
    await screen.getByRole('combobox', 'Kỳ').selectOption({ label: `Kỳ ${target.label} · Đã chốt` });
    const off = await browser.onDialog('accept');
    await screen.getByRole('region', 'Bảng nhập hàng').getByRole('button', `Sửa dòng ${row.stt} (${row.productName})`).tap();
    await screen.getByLabel('Số lượng *').fill(String(row.qty + 1));
    await screen.getByRole('button', 'Lưu thay đổi').tap();
    try {
      await expect.poll(async () => (await (await api('/api/v1/dashboard')).json()).totals.totalCost).toBe(before + unit);
      const now: any[] = await (await api('/api/v1/periods')).json();
      expect(now.find(p => p.id === after.id).openingCost).toBe(after.openingCost + unit);
      await app.open('/#periods');
      await expect(screen.getByRole('region', 'Bảng lịch sử kỳ').getByRole('row').filter({ hasText: new RegExp(`^${target.label}`) })).toContainText('Đã sửa sau chốt');
    } finally {
      // Put the row back; the month matches its closing figures again
      const { id, periodId, productId, source, date, price, qty, discount, tracking, merged, link, note } = row;
      const res = await api(`/api/v1/purchases/${id}?force=true`, { method: 'PUT', json: { periodId, productId, source, date, price, qty, discount, tracking, merged, link, note } });
      expect(res.status).toBe(200);
      await off();
    }
    await browser.reload();
    await expect(screen.getByRole('region', 'Bảng lịch sử kỳ').getByRole('row').filter({ hasText: new RegExp(`^${target.label}`) })).toContainText('Khớp');
  });
});
