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
    await card.getByRole('button', 'Mở chi tiết').tap(); // queued cards start folded
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
    await skipCard.getByRole('button', 'Mở chi tiết').tap();
    await skipCard.getByRole('button', 'Bỏ qua').tap();
    await skipCard.getByLabel('Lý do bỏ qua').fill('đơn huỷ');
    await skipCard.getByRole('button', 'Xác nhận bỏ qua').tap();
    await expect(screen.getByRole('status')).toContainText('Đã bỏ qua đơn này.');
    // Listed under "Đã bỏ qua" with who and why, and restored from there
    const skipped = screen.getByRole('article', `Đơn Rakuma ${no.skip}`);
    await skipped.getByRole('button', 'Mở chi tiết').tap();
    await expect(skipped).toContainText('Bấm Bỏ qua: đơn huỷ');
    await skipped.getByRole('button', 'Khôi phục').tap();
    await expect(screen.getByRole('status')).toContainText('Đã khôi phục, đơn về hàng chờ.');

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

// Owner request 2026-10-10: product picked from keywords, "4BOX" split into qty and unit price, gap badges, chat panel.
test('approve form fills product and quantity from the title; missing info is flagged; chat is readable', { session: 'owner' }, async ({ app, screen, api, browser }) => {
  await app.open('/');
  const id = Date.now().toString(36);
  const products: any[] = await (await api('/api/v1/products')).json();
  const target = products.find(p => p.active);
  const before = target.keywords;
  const res = await api(`/api/v1/products/${target.id}`, { method: 'PATCH', json: { keywords: `kw${id}` } });
  expect(res.status).toBe(200);
  const key = await (await api('/api/v1/api-keys', { method: 'POST', json: { name: `e2e-guess-${id}`, scope: 'write' } })).json();
  const sync = (orders: unknown[]) => fetch(new URL('/api/v1/rakuma/sync', app.baseUrl), {
    method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ orders }),
  });
  const guessNo = `E2EG${id}`, gapNo = `E2EH${id}`;
  try {
    expect((await sync([
      { orderNo: guessNo, link: `https://item.fril.jp/g${id}`, title: `ポケモン KW${id.toUpperCase()} 未開封 4BOX`, status: '支払い (期限 10/12 23:59)', price: 100000, seller: `shopG-${id}`, chatOpen: true,
        messages: [{ from: 'buyer', at: '2026/10/06 15:56', body: 'よろしくお願いします' }, { from: 'seller', at: '2026/10/07 09:00', body: '発送しました\n明日届きます' }] },
      { orderNo: gapNo, link: `https://item.fril.jp/h${id}`, title: '', status: '商品の受取 (発送済み 10/08)', price: 0, seller: `shopH-${id}`, chatOpen: true },
    ])).status).toBe(200);

    await app.open('/#rakuma');
    await browser.reload();

    // Inbox card: shop, item link and the new messages; "Tin mới" divider, multi-line text kept
    const inbox = screen.getByRole('article', `Đơn Rakuma ${guessNo}`);
    await expect(inbox.getByRole('link', /KW/)).toHaveAttribute('href', `https://item.fril.jp/g${id}`);
    const chat = inbox.getByRole('region', `Tin nhắn với shopG-${id}`);
    await expect(chat).toContainText('Tin mới');
    await expect(chat).toContainText('明日届きます');

    // Gap badges on the queued card
    const gapCard = screen.getByRole('article', `Đơn Rakuma ${gapNo}`).first();
    await expect(gapCard).toContainText('Thiếu tên món');
    await expect(gapCard).toContainText('Thiếu giá');
    await expect(gapCard).toContainText('Đã gửi, chưa có mã vận đơn');

    // The full card (filters) keeps the approve form, filled from the title and keywords
    const status = screen.getByRole('combobox', 'Trạng thái');
    await status.selectOption({ label: 'Chờ duyệt' });
    const card = screen.getByRole('article', `Đơn Rakuma ${guessNo}`);
    await card.getByRole('button', 'Mở chi tiết').tap();
    const form = card.getByRole('form', `Duyệt đơn ${guessNo}`);
    await expect(form.getByLabel('Sản phẩm *')).toHaveValue(target.id);
    await expect(form.getByLabel('Số lượng *')).toHaveValue('4');
    await expect(form.getByLabel('Giá nhập mỗi cái (¥) *')).toHaveValue('25000');
    await expect(form).toContainText(`Tự chọn “${target.name}” theo từ khóa`);

    await status.selectOption({ label: 'Thiếu tên hoặc giá' });
    await expect(screen.getByRole('article', `Đơn Rakuma ${gapNo}`)).toBeVisible();
    await expect(screen.getByRole('article', `Đơn Rakuma ${guessNo}`)).toBeHidden();
  } finally {
    await api(`/api/v1/products/${target.id}`, { method: 'PATCH', json: { keywords: before || '' } });
    await api(`/api/v1/api-keys/${key.record.id}/revoke`, { method: 'POST' });
  }
});

// Owner request 2026-10-11: paid orders go straight into Nhập hàng; a combined order is split into one row per product.
test('sync writes a paid order into Nhập hàng; the owner splits the combined order by product', { session: 'owner' }, async ({ app, screen, api, browser }) => {
  await app.open('/');
  const id = Date.now().toString(36);
  const dash = await (await api('/api/v1/dashboard')).json();
  const [a, b] = ((await (await api('/api/v1/products')).json()) as any[]).filter(p => p.active);
  const key = await (await api('/api/v1/api-keys', { method: 'POST', json: { name: `e2e-split-${id}`, scope: 'write' } })).json();
  const link = `https://item.fril.jp/s${id}`;
  const rowsOfOrder = async () => ((await (await api('/api/v1/purchases')).json()) as any[]).filter(p => p.link === link || p.tracking === `TRK${id}`);
  try {
    const res = await (await fetch(new URL('/api/v1/rakuma/sync', app.baseUrl), {
      method: 'POST', headers: { authorization: `Bearer ${key.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ orders: [{ orderNo: `E2ES${id}`, link, title: `まとめ売り zz${id}`, status: '商品の受取 (発送済み 10/08)',
        date: dash.period.start, price: 30000, discount: 0, tracking: `TRK${id}`, seller: `shopS-${id}`, chatOpen: true }] }),
    })).json();
    expect(res.purchased).toBe(1);

    await app.open('/#purchases');
    await browser.reload();
    await expect(screen.getByRole('region', 'Cảnh báo nhập hàng')).toContainText('dòng chưa có tên');
    await screen.getByRole('button', /^Xem \d+ dòng chưa có tên$/).tap();
    const row = screen.getByRole('region', 'Bảng nhập hàng').getByRole('row').filter({ hasText: `TRK${id}` });
    await expect(row).toContainText('Chưa có tên');
    await row.getByRole('button', /^Tách đơn gộp/).tap();

    const form = screen.getByRole('form', /^Tách đơn gộp/);
    await form.getByRole('combobox', 'Sản phẩm 1').selectOption({ label: a.name });
    await form.getByLabel('Số lượng sản phẩm 1').fill('2');
    await form.getByLabel('Giá mỗi cái sản phẩm 1 (¥)').fill('10000');
    await form.getByRole('combobox', 'Sản phẩm 2').selectOption({ label: b.name });
    await form.getByLabel('Giá mỗi cái sản phẩm 2 (¥)').fill('9000');
    await expect(form).toContainText('còn thiếu 1.000¥');
    await expect(form.getByRole('button', 'Lưu 2 dòng')).toBeDisabled();
    await form.getByLabel('Giá mỗi cái sản phẩm 2 (¥)').fill('10000');
    await form.getByRole('button', 'Lưu 2 dòng').tap();
    await expect(screen.getByRole('status')).toContainText('Đã tách thành 2 dòng nhập.');

    const rows = await rowsOfOrder();
    expect(rows.map(r => [r.productId, r.qty, r.total, r.link ? 'link' : '', r.merged]).sort()).toEqual(
      [[a.id, 2, 20000, 'link', true], [b.id, 1, 10000, '', true]].sort());
  } finally {
    for (const r of await rowsOfOrder()) await api(`/api/v1/purchases/${r.id}`, { method: 'DELETE' });
    await api(`/api/v1/api-keys/${key.record.id}/revoke`, { method: 'POST' });
  }
});
