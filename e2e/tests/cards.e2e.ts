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
  } finally {
    for (const p of ((await (await api('/api/v1/purchases')).json()) as any[]).filter(p => p.note === note)) {
      await api(`/api/v1/purchases/${p.id}`, { method: 'DELETE' });
    }
    if (cardId) await api(`/api/v1/cards/${cardId}`, { method: 'DELETE' });
  }
});
