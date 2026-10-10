import { describe } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { test } from './fixtures.ts';

const MCP_ENTRY = `${process.env.RAKUMA_MCP_DIR ?? '../../rakuma-mercari-mcp'}/src/index.js`;
const json = (r: any) => JSON.parse(r.content[0].text);

async function startMcp(baseUrl: string, apiKey: string) {
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [MCP_ENTRY], stderr: 'pipe',
    env: { PATH: process.env.PATH ?? '', RAKUMA_API_URL: baseUrl, RAKUMA_API_KEY: apiKey },
  }));
  return client;
}

describe('Cài đặt', () => {
  test('API key made in Cài đặt drives the real MCP server, revoking it cuts MCP off', { session: 'owner' }, async ({ app, screen, api }) => {
    const name = `e2e-mcp-${Date.now().toString(36)}`;
    const product = `E2E MCP ${name}`;
    await app.open('/#settings');
    await screen.getByLabel('Tên key *').fill(name);
    await screen.getByLabel('Quyền').selectOption({ label: 'Đọc và ghi' });
    await screen.getByRole('button', 'Tạo key').tap();
    const keyText = screen.getByText(/^rk_live_[0-9a-f]+$/);
    await expect(keyText).toBeVisible();
    const key = (await keyText.textContent())!.trim();
    await screen.getByRole('button', 'Tôi đã lưu key').tap();
    await expect(keyText).toBeHidden();

    const mcp = await startMcp(app.baseUrl, key);
    try {
      expect((await mcp.listTools()).tools).toHaveLength(22);

      const dash = json(await mcp.callTool({ name: 'get_dashboard', arguments: {} }));
      const server = await (await api('/api/v1/dashboard')).json();
      expect(dash.totals.totalCost).toBe(server.totals.totalCost);

      const added = json(await mcp.callTool({ name: 'add_product', arguments: { name: product } }));
      expect(added.name).toBe(product);

      // Overselling is a warning: nothing saved until the user confirms (GD-05)
      const warned = json(await mcp.callTool({ name: 'add_sale', arguments: { product, qty: 1, price: 1000 } }));
      expect(warned.warnings.length).toBeGreaterThan(0);
      const sales: any[] = await (await api('/api/v1/sales')).json();
      expect(sales.filter(s => s.productName === product)).toHaveLength(0);

      // Revoke in the UI
      await screen.getByRole('button', `Thu hồi key ${name}`).tap();
      await screen.getByRole('button', 'Xác nhận thu hồi').tap();
      await expect(screen.getByRole('status')).toContainText(`Đã thu hồi key “${name}”`);
      const denied = await mcp.callTool({ name: 'list_products', arguments: {} });
      expect(denied.isError).toBe(true);
      expect((denied.content as any)[0].text).toContain('revoked');

      await api(`/api/v1/products/${added.id}`, { method: 'DELETE' });
    } finally {
      await mcp.close();
    }
  });

  test('saving Thông số chung persists, invalid values are rejected', { session: 'owner' }, async ({ app, screen, api, browser }) => {
    await app.open('/#settings');
    const original = await (await api('/api/v1/settings')).json();
    try {
      await screen.getByLabel('Tỷ giá (¥ → ₫)').fill('171.5');
      await screen.getByRole('button', 'Lưu cài đặt').tap();
      await expect(screen.getByRole('status')).toContainText('Đã lưu cài đặt.');
      expect((await (await api('/api/v1/settings')).json()).rate).toBe(171.5);
      await browser.reload();
      await expect(screen.getByLabel('Tỷ giá (¥ → ₫)')).toHaveValue('171.5');

      await screen.getByLabel('Thuế nhập khẩu (0,1 = 10%)').fill('2');
      await screen.getByRole('button', 'Lưu cài đặt').tap();
      await expect(screen.getByText('Thuế nhập khẩu từ 0 đến 1 (0,1 = 10%).')).toBeVisible();
    } finally {
      await api('/api/v1/settings', { method: 'PUT', json: original });
    }
  });

  // Fresh sign-in (no saved session): signing out here must not end the shared owner session.
  test('change password, sign out, sign in with the new one', async ({ app, screen, api }) => {
    const owner = credentials.user('owner');
    const next = `e2e-${Date.now()}-pw`;
    await app.open('/');
    await screen.getByLabel('Email').fill(owner.username);
    await screen.getByLabel('Mật khẩu').fill(owner.password);
    await screen.getByRole('button', 'Đăng nhập').tap();
    await app.open('/#settings');

    await screen.getByLabel('Mật khẩu hiện tại').fill('wrong-current-password');
    await screen.getByLabel('Mật khẩu mới (ít nhất 10 ký tự)').fill(next);
    await screen.getByRole('button', 'Đổi mật khẩu').tap();
    await expect(screen.getByText('Mật khẩu hiện tại không đúng.')).toBeVisible();

    await screen.getByLabel('Mật khẩu hiện tại').fill(owner.password);
    await screen.getByLabel('Mật khẩu mới (ít nhất 10 ký tự)').fill(next);
    await screen.getByRole('button', 'Đổi mật khẩu').tap();
    await expect(screen.getByRole('status')).toContainText('Đã đổi mật khẩu.');

    try {
      await screen.getByRole('button', 'Đăng xuất').tap();
      await expect(screen.getByRole('heading', 'Đăng nhập')).toBeVisible();
      await screen.getByLabel('Email').fill(owner.username);
      await screen.getByLabel('Mật khẩu').fill(next);
      await screen.getByRole('button', 'Đăng nhập').tap();
      await expect(screen.getByRole('button', /^Đăng xuất .+@/)).toBeVisible(); // signed in again (header shows the account)
    } finally {
      // Put the run's password back so later runs on this stack still sign in
      const res = await api('/api/v1/auth/password', { method: 'PUT', json: { current: next, next: process.env.RAKUMA_E2E_PASSWORD } });
      expect(res.status).toBe(204);
    }
  });
});
