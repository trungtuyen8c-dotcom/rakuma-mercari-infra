import { test, expect } from 'e2e';
import { connect } from 'node:net';

// Read-only checks against the live VPS: no sign-in, no writes, no wrong-password attempts (they count toward the IP lockout).

const reachable = (host: string, port: number) => new Promise<boolean>(resolve => {
  const s = connect({ host, port, timeout: 4000 });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('timeout', () => { s.destroy(); resolve(false); });
  s.once('error', () => resolve(false));
});

test('runs in production mode: password sign-in, no dev login', async ({ app }) => {
  const cfg = await (await fetch(new URL('/api/v1/auth/config', app.baseUrl))).json();
  expect(cfg.devLogin).toBe(false);
  expect(cfg.password).toBe(true);
});

test('data routes need a session or API key', async ({ app }) => {
  for (const path of ['/api/v1/state', '/api/v1/dashboard', '/api/v1/products', '/api/v1/settings', '/api/v1/api-keys']) {
    expect((await fetch(new URL(path, app.baseUrl))).status).toBe(401);
  }
  const fake = await fetch(new URL('/api/v1/stock', app.baseUrl), { headers: { authorization: 'Bearer rk_live_0000' } });
  expect(fake.status).toBe(401);
});

const PUBLIC = process.env.RAKUMA_PROD_HOST ?? '222.255.181.169';

test('public IP serves the app over HTTP and the API answers', async () => {
  const page = await fetch(`http://${PUBLIC}/`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<div id="root">');
  expect((await fetch(`http://${PUBLIC}/api/v1/auth/config`)).status).toBe(200);
  expect((await fetch(`http://${PUBLIC}/api/v1/state`)).status).toBe(401);
});

test('Postgres is not reachable from the internet', async () => {
  const host = PUBLIC;
  for (const port of [5432, 55432]) expect(await reachable(host, port)).toBe(false);
});

test('the sign-in page renders', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', 'Đăng nhập')).toBeVisible();
  await expect(screen.getByLabel('Email')).toBeVisible();
  await expect(screen.getByRole('button', 'Tiếp tục với Google')).toBeHidden();
});
