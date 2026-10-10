import { test, expect } from 'e2e';

test('nginx serves the SPA with no-cache and falls back to index.html', async ({ app }) => {
  const root = await fetch(new URL('/', app.baseUrl));
  expect(root.status).toBe(200);
  expect(root.headers.get('cache-control')).toBe('no-cache');
  const html = await root.text();
  expect(html).toContain('<div id="root">');

  const deep = await fetch(new URL('/some/unknown/route', app.baseUrl));
  expect(deep.status).toBe(200);
  expect(await deep.text()).toBe(html);
});

test('hashed assets are served immutable, missing assets 404', async ({ app }) => {
  const html = await (await fetch(new URL('/', app.baseUrl))).text();
  const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
  expect(asset).toBeTruthy();
  const res = await fetch(new URL(asset!, app.baseUrl));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('immutable');
  expect((await fetch(new URL('/assets/nope-123.js', app.baseUrl))).status).toBe(404);
});

test('/api is proxied to the Go backend', async ({ app }) => {
  const res = await fetch(new URL('/api/v1/auth/config', app.baseUrl));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(await res.json()).toEqual({ devLogin: expect.any(Boolean), google: expect.any(Boolean), password: true });
});
