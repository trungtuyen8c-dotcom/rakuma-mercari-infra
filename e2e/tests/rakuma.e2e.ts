import { expect } from 'e2e';
import { test } from './fixtures.ts';

// Rakuma sync as Claude's MCP does it (write API key), then the owner works the queue in the web app.
test('synced Rakuma orders: approve into Nhập hàng, dismiss/restore, reply to seller', { session: 'owner' }, async ({ app, screen, api, browser }) => {
  await app.open('/');
  const id = Date.now().toString(36);
  const key = await (await api('/api/v1/api-keys', { method: 'POST', json: { name: `e2e-sync-${id}`, scope: 'write' } })).json();
  const bot = (path: string, json?: unknown) => fetch(new URL(path, app.baseUrl), {
    method: json === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const no = { approve: `E2EA${id}`, chat: `E2EB${id}`, skip: `E2EC${id}` };
  const order = (orderNo: string, extra = {}) => ({
    orderNo, link: `https://item.fril.jp/e2e${orderNo.toLowerCase()}`, title: `E2E món ${orderNo}`, status: 'Đang vận chuyển',
    price: 3000, discount: 200, seller: 'e2e-shop', chatOpen: true, ...extra,
  });
  const dash = await (await api('/api/v1/dashboard')).json();
  let purchaseId: string | undefined;

  try {
    // Sync three orders, one with a seller message
    const sync = await bot('/api/v1/rakuma/sync', {
      orders: [
        order(no.approve),
        order(no.chat, { messages: [{ from: 'seller', at: '2026-09-02 10:00', body: '発送しました' }] }),
        order(no.skip),
      ],
    });
    expect(sync.status).toBe(200);
    const res = await sync.json();
    expect(res.created).toBe(3);
    expect(res.newMessages).toBe(1);

    // Approve: (3000 - 200) x 1 = 2800 goes into Nhập hàng with the order's link
    await app.open('/#rakuma');
    await browser.reload(); // the SPA loads /state once; orders written by the bot appear after a reload
    const card = screen.getByRole('article', `Đơn Rakuma ${no.approve}`);
    const form = card.getByRole('form', `Duyệt đơn ${no.approve}`);
    await form.getByLabel('Sản phẩm *').selectOption({ label: '30th Celebration' });
    await form.getByLabel('Ngày đặt').fill(dash.period.start);
    await expect(form).toContainText('Tổng tiền: 2.800¥');
    await form.getByRole('button', 'Lưu vào Nhập hàng').tap();
    await expect(screen.getByRole('status')).toContainText('Đã nhập “30th Celebration” từ Rakuma: 2.800¥');

    const orders: any[] = await (await bot('/api/v1/rakuma/orders')).json();
    const approved = orders.find(o => o.orderNo === no.approve);
    purchaseId = approved.purchaseId;
    expect(purchaseId).toBeTruthy();
    const purchases: any[] = await (await api('/api/v1/purchases')).json();
    const p = purchases.find(x => x.id === purchaseId);
    expect(p.link).toBe(approved.link);
    expect(p.total).toBe(2800);

    // Approving twice is refused
    const again = await api(`/api/v1/rakuma/orders/${approved.id}/approve`, { method: 'POST', json: { productId: '1', price: 3000, qty: 1 } });
    expect(again.status).toBe(409);

    // Dismiss, then restore
    const skipCard = screen.getByRole('article', `Đơn Rakuma ${no.skip}`);
    await skipCard.getByRole('button', 'Bỏ qua').tap();
    await expect(screen.getByRole('status')).toContainText('Đã bỏ qua đơn này.');
    await screen.getByRole('button', /^Xem \d+ đơn khác/).tap();
    const skipped = screen.getByRole('article', `Đơn Rakuma ${no.skip}`);
    await skipped.getByRole('button', 'Mở chi tiết').tap();
    await skipped.getByRole('button', 'Đưa về hàng chờ').tap();
    await expect(screen.getByRole('status')).toContainText('Đã đưa đơn về hàng chờ.');

    // Seller message is shown; the owner queues a reply, the sync bot marks it sent
    const chat = screen.getByRole('article', `Đơn Rakuma ${no.chat}`).first();
    await expect(chat).toContainText('発送しました');
    await chat.getByLabel('Trả lời người bán (viết tiếng Việt)').fill('Cảm ơn shop');
    await chat.getByRole('button', 'Gửi trả lời').tap();
    await expect.poll(async () => {
      const os: any[] = await (await bot('/api/v1/rakuma/orders')).json();
      return os.find(o => o.orderNo === no.chat).replies.map((r: any) => r.status);
    }).toEqual(['PENDING']);
    const chatOrder = ((await (await bot('/api/v1/rakuma/orders')).json()) as any[]).find(o => o.orderNo === no.chat);
    const sent = await bot(`/api/v1/rakuma/replies/${chatOrder.replies[0].id}/sent`, { bodyJa: 'ありがとうございます' });
    expect(sent.status).toBe(200);
    const final = ((await (await bot('/api/v1/rakuma/orders')).json()) as any[]).find(o => o.orderNo === no.chat);
    expect(final.replies[0].status).toBe('SENT');
    expect(final.replies[0].bodyJa).toBe('ありがとうございます');
  } finally {
    if (purchaseId) await api(`/api/v1/purchases/${purchaseId}`, { method: 'DELETE' });
    await api(`/api/v1/api-keys/${key.record.id}/revoke`, { method: 'POST' });
  }
});
