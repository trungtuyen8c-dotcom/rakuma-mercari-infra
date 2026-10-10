import { afterEach } from '@e2e-dev/web';
import { expect } from 'e2e';
import { test } from './fixtures.ts';

const yen = (n: number) => n.toLocaleString('vi-VN') + '¥';

let created: { name: string; note: string } | undefined;

// Cleanup goes through the API: rows first, then the product (a product with rows cannot be deleted).
afterEach(async ({ api }) => {
  if (!created) return;
  const { name, note } = created;
  created = undefined;
  const sales: any[] = await (await api('/api/v1/sales')).json();
  for (const s of sales.filter(s => s.productName === name)) await api(`/api/v1/sales/${s.id}`, { method: 'DELETE' });
  const purchases: any[] = await (await api('/api/v1/purchases')).json();
  for (const p of purchases.filter(p => p.note === note)) await api(`/api/v1/purchases/${p.id}`, { method: 'DELETE' });
  const products: any[] = await (await api('/api/v1/products')).json();
  for (const p of products.filter(p => p.name === name)) await api(`/api/v1/products/${p.id}`, { method: 'DELETE' });
});

test('product -> purchase -> sale updates stock and dashboard', { session: 'owner' }, async ({ app, screen, api }) => {
  const id = Date.now().toString(36);
  const name = `E2E card ${id}`;
  const note = `e2e-${id}`;
  created = { name, note };

  await app.open('/');
  const dash = await (await api('/api/v1/dashboard')).json();
  const before = dash.totals;
  const day = dash.period.start; // a date inside the open period, so the test does not depend on the seed's months

  // Product
  await app.open('/#products');
  await screen.getByRole('button', 'Thêm sản phẩm').tap();
  await screen.getByLabel('Tên sản phẩm *').fill(name);
  await screen.getByRole('button', 'Lưu').tap();
  await expect(screen.getByRole('region', 'Bảng danh mục sản phẩm').getByText(name)).toBeVisible();

  // Purchase: (1000 - 100) x 2 = 1800 (BR-03)
  await app.open('/#purchases');
  await screen.getByRole('button', 'Thêm dòng nhập').tap();
  await screen.getByLabel('Sản phẩm *').selectOption({ label: name });
  await screen.getByLabel('Ngày đặt').fill(day);
  await screen.getByLabel('Giá nhập mỗi cái (¥) *').fill('1000');
  await screen.getByLabel('Số lượng *').fill('2');
  await screen.getByLabel('Giảm giá mỗi cái (¥)').fill('100');
  await screen.getByLabel('Ghi chú').fill(note);
  await expect(screen.getByText('Tổng tiền: 1.800¥')).toBeVisible();
  await screen.getByRole('button', 'Lưu dòng nhập').tap();
  const purchaseRow = screen.getByRole('region', 'Bảng nhập hàng').getByRole('row').filter({ hasText: name });
  await expect(purchaseRow).toContainText(yen(1800));

  // Stock after purchase
  await app.open('/#inventory');
  await screen.getByRole('searchbox', 'Tìm sản phẩm').fill(name);
  const stockRow = screen.getByRole('region', 'Bảng tồn kho').getByRole('row').filter({ hasText: name });
  await expect(stockRow.getByRole('cell').nth(3)).toHaveText('2');

  // Sale: 1 x 5000 - 300 ship = 4700 (BR-07)
  await app.open('/#sales');
  await screen.getByRole('button', 'Thêm đơn bán').tap();
  await screen.getByLabel('Sản phẩm *').selectOption({ label: name });
  await screen.getByLabel('Ngày bán').fill(day);
  await screen.getByLabel('Số lượng bán *').fill('1');
  await screen.getByLabel('Đơn giá mỗi cái (¥) *').fill('5000');
  await screen.getByLabel('Phí ship shop chịu (¥)').fill('300');
  await screen.getByLabel('Khách mua').fill(note);
  await screen.getByRole('button', 'Lưu đơn bán').tap();
  const saleRow = screen.getByRole('region', 'Bảng bán hàng').getByRole('row').filter({ hasText: name });
  await expect(saleRow).toContainText(yen(4700));

  // Stock after sale: 2 - 1 = 1 (BR-09)
  await app.open('/#inventory');
  await screen.getByRole('searchbox', 'Tìm sản phẩm').fill(name);
  await expect(stockRow.getByRole('cell').nth(4)).toHaveText('1');
  await expect(stockRow.getByRole('spinbutton')).toHaveValue('1'); // "SL hiện tại" is an editable input

  // Dashboard totals moved by exactly the new rows
  await app.open('/#dashboard');
  await expect(screen.getByText(yen(before.totalCost + 1800), { exact: true })).toBeVisible();
  await expect(screen.getByText(yen(before.totalRevenue + 4700), { exact: true })).toBeVisible();
  await expect(screen.getByText(yen(before.totalProfit + 4700 - 1800), { exact: true })).toBeVisible();
});
