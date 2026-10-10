import { expect } from 'e2e';
import { test } from './fixtures.ts';

// Changes the shared database (opens and closes a month), so it runs on the isolated e2e stack only.
test('open the next month early, then close the old one (BR-14)', { session: 'owner' }, async ({ app, screen, api }) => {
  await app.open('/');
  const periods = async () => (await (await api('/api/v1/periods')).json()) as any[];
  const open = (await periods()).filter(p => p.status === 'OPEN');
  expect(open).toHaveLength(1); // the seed and every earlier run leave exactly one open month
  const old = open[0];
  const dash = await (await api('/api/v1/dashboard')).json();
  const stockBefore: any[] = (await (await api('/api/v1/stock')).json()).rows;

  // Open the next month while the old one is still open
  await app.open('/#periods');
  await screen.getByRole('button', /^Mở kỳ \d\d\/\d{4}$/).tap();
  await expect(screen.getByRole('heading', /đã mở trước$/)).toBeVisible();
  const both = (await periods()).filter(p => p.status === 'OPEN');
  expect(both).toHaveLength(2);
  const next = both.find(p => p.id !== old.id);

  // A third open month is refused by the server
  const third = await api('/api/v1/periods/open-next', { method: 'POST', json: {} });
  expect(third.status).toBe(409);

  // Close the old month through the confirm dialog
  await screen.getByRole('button', `Chốt kỳ ${old.label}`).tap();
  const dialog = screen.getByRole('alertdialog');
  await expect(dialog).toContainText(`Chốt kỳ ${old.label}?`);
  await dialog.getByRole('button', 'Xác nhận chốt').tap();
  await expect(screen.getByRole('status')).toContainText(`Đã chốt kỳ ${old.label}`);

  const after = await periods();
  const closed = after.find(p => p.id === old.id);
  const nowOpen = after.find(p => p.id === next.id);
  expect(closed.status).toBe('CLOSED');
  expect(closed.closingCost).toBe(dash.totals.totalCost);
  expect(closed.closingRevenue).toBe(dash.totals.totalRevenue);
  expect(nowOpen.status).toBe('OPEN');
  expect(nowOpen.openingCost).toBe(dash.totals.totalCost);
  expect(nowOpen.openingRevenue).toBe(dash.totals.totalRevenue);

  // Each product's opening stock in the new month = its current stock at closing
  const stockAfter: any[] = (await (await api('/api/v1/stock')).json()).rows;
  for (const r of stockBefore) {
    expect(stockAfter.find(x => x.productId === r.productId)?.opening).toBe(r.current);
  }

  // Cumulative totals do not move when a month is closed
  const dashAfter = await (await api('/api/v1/dashboard')).json();
  expect(dashAfter.period.id).toBe(next.id);
  expect(dashAfter.totals.totalCost).toBe(dash.totals.totalCost);
  expect(dashAfter.totals.totalRevenue).toBe(dash.totals.totalRevenue);

  const row = screen.getByRole('region', 'Bảng lịch sử kỳ').getByRole('row').filter({ hasText: new RegExp(`^${old.label}`) });
  await expect(row).toContainText('Khớp');
});
