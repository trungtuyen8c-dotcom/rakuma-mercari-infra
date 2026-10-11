import { expect } from 'e2e';
import { test } from './fixtures.ts';

// Owner request 2026-10-11: payment cards shared with the order and yahoo projects; this project's charges are
// published as a ledger the other projects add to the same card.
test('add a card, pay a purchase with it, and read it back from the card ledger', { session: 'owner' }, async ({ app, screen, api, browser }) => {
  await app.open('/');
  const id = Date.now().toString(36);
  const dash = await (await api('/api/v1/dashboard')).json();
  const cardName = `E2E card ${id}`;
  const note = `card-${id}`;
  let cardId: string | undefined;
  try {
    await app.open('/#settings');
    const cards = screen.getByRole('form', 'Thêm thẻ');
    await cards.getByLabel('Tên thẻ *').fill(cardName);
    await cards.getByRole('button', 'Thêm thẻ').tap();
    await expect(screen.getByRole('status')).toContainText(`Đã thêm thẻ “${cardName}”.`);
    const list = screen.getByRole('region', 'Danh sách thẻ');
    await list.getByRole('radio', `Thẻ mặc định cho đơn Rakuma: ${cardName}`).tap();
    await expect(list.getByRole('radio', `Thẻ mặc định cho đơn Rakuma: ${cardName}`)).toBeChecked();
    cardId = ((await (await api('/api/v1/cards')).json()) as any[]).find(c => c.name === cardName).id;

    // The default card is preselected on a new purchase row
    await app.open('/#purchases');
    await browser.reload();
    await screen.getByRole('button', 'Thêm dòng nhập').tap();
    await expect(screen.getByLabel('Thẻ thanh toán')).toHaveValue(cardId!);
    await screen.getByLabel('Sản phẩm *').selectOption({ index: 1 });
    await screen.getByLabel('Ngày đặt').fill(dash.period.start);
    await screen.getByLabel('Giá nhập mỗi cái (¥) *').fill('12000');
    await screen.getByLabel('Số lượng *').fill('2');
    await screen.getByLabel('Ghi chú').fill(note);
    await screen.getByRole('button', 'Lưu dòng nhập').tap();
    const row = screen.getByRole('region', 'Bảng nhập hàng').getByRole('row').filter({ hasText: note });
    await expect(row).toContainText(cardName);

    const ledger: any[] = await (await api(`/api/v1/wallet-ledger?wallet=${encodeURIComponent(cardName)}`)).json();
    expect(ledger.map(r => [r.wallet, r.project, r.date, r.amount, r.category])).toEqual([[cardName, 'rakuma', dash.period.start, -24000, 'Mua hàng']]);

    // Sổ thẻ adds the charges up per day / week / month for checking against the card statement
    await app.open('/#cards');
    await screen.getByLabel('Từ').fill(dash.period.start);
    await screen.getByLabel('Đến').fill(dash.period.end);
    await screen.getByRole('combobox', 'Thẻ').selectOption({ label: cardName });
    await screen.getByRole('radio', 'Tháng').tap();
    const table = screen.getByRole('region', 'Bảng sổ thẻ');
    const month = table.getByRole('row').filter({ hasText: cardName });
    await expect(month).toContainText('24.000¥');
    await month.getByRole('button', 'Xem dòng').tap();
    await expect(table).toContainText('Sổ kho Rakuma, kỳ');
  } finally {
    for (const p of ((await (await api('/api/v1/purchases')).json()) as any[]).filter(p => p.note === note)) {
      await api(`/api/v1/purchases/${p.id}`, { method: 'DELETE' });
    }
    if (cardId) await api(`/api/v1/cards/${cardId}`, { method: 'DELETE' });
  }
});

// Owner request 2026-10-11: note a refund next to the row; when the money is back, book it and drop the row. The card
// ledger keeps the charge and the refund; a month checked against the statement warns before it changes.
test('refund: waiting note, booked refund removes the row, ledger keeps both lines; reconciled month warns', { session: 'owner' }, async ({ app, screen, api, browser }) => {
  await app.open('/');
  const id = Date.now().toString(36);
  const dash = await (await api('/api/v1/dashboard')).json();
  const product = ((await (await api('/api/v1/products')).json()) as any[]).find(p => p.active);
  const card = await (await api('/api/v1/cards', { method: 'POST', json: { name: `4309-${id}` } })).json();
  const note = `refund-${id}`;
  const mk = async (price: number, n: string) => (await (await api('/api/v1/purchases', { method: 'POST',
    json: { productId: product.id, price, qty: 1, date: dash.period.start, cardId: card.id, note: n } })).json()).id;
  const keep = await mk(5000, `${note}-keep`);
  await mk(24000, note);
  try {
    await app.open('/#purchases');
    await browser.reload();
    const row = screen.getByRole('region', 'Bảng nhập hàng').getByRole('row').filter({ hasText: `${note}` }).filter({ hasNotText: 'keep' });
    await row.getByRole('button', /^Hoàn tiền dòng/).tap();
    const dialog = screen.getByRole('dialog', 'Hoàn tiền');
    await dialog.getByLabel('Ghi chú (lý do, ngày hẹn hoàn…)').fill('Shop huỷ, chờ Rakuma hoàn');
    await dialog.getByRole('button', 'Lưu ghi chú chờ hoàn').tap();
    await expect(row).toContainText('Chờ hoàn tiền: Shop huỷ, chờ Rakuma hoàn');
    await expect(screen.getByRole('region', 'Cảnh báo nhập hàng')).toContainText('đang chờ hoàn tiền về thẻ');

    // Money is back: book it; the row leaves Nhập hàng
    await row.getByRole('button', /^Hoàn tiền dòng/).tap();
    await dialog.getByLabel('Ngày tiền về').fill(dash.period.start);
    await expect(dialog.getByRole('checkbox', /Xoá dòng nhập này/)).toBeChecked();
    await dialog.getByRole('button', 'Ghi hoàn tiền').tap();
    await expect(screen.getByRole('status')).toContainText(`Đã ghi hoàn 24.000¥ về thẻ 4309-${id}.`);
    await expect(row).toHaveCount(0);

    const ledger: any[] = await (await api(`/api/v1/wallet-ledger?wallet=4309-${id}`)).json();
    expect(ledger.map(r => [r.category, r.amount]).sort()).toEqual([['Hoàn tiền', 24000], ['Mua hàng', -24000], ['Mua hàng', -5000]].sort());

    // Sổ thẻ, month view: mark the month checked; a later price change asks first
    await app.open('/#cards');
    await screen.getByLabel('Từ').fill(dash.period.start);
    await screen.getByLabel('Đến').fill(dash.period.end);
    await screen.getByRole('combobox', 'Thẻ').selectOption({ label: `4309-${id}` });
    await screen.getByRole('radio', 'Tháng').tap();
    const month = screen.getByRole('region', 'Bảng sổ thẻ').getByRole('row').filter({ hasText: `4309-${id}` }).first();
    await expect(month).toContainText('29.000¥');
    await expect(month).toContainText('24.000¥');
    await month.getByRole('button', 'Đánh dấu đã khớp sao kê').tap();
    await expect(month).toContainText('Đã đối soát');
    const edit = await api(`/api/v1/purchases/${keep}`, { method: 'PUT', json: { productId: product.id, price: 6000, qty: 1, date: dash.period.start, note: `${note}-keep` } });
    expect(edit.status).toBe(409);
    expect((await edit.json()).warnings[0]).toContain('đã đối soát');
  } finally {
    for (const p of ((await (await api('/api/v1/purchases')).json()) as any[]).filter(p => (p.note || '').startsWith(note))) {
      await api(`/api/v1/purchases/${p.id}?force=true`, { method: 'DELETE' });
    }
  }
});
