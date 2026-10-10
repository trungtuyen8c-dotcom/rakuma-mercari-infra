import { test as base } from '@e2e-dev/web';

type Api = (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;

// `api` calls the backend through nginx with the signed-in browser's session cookie.
export const test = base.extend<{ api: Api }>({
  api: async ({ app, browser }, use) => {
    await use(async (path, init = {}) => {
      const url = new URL(path, app.baseUrl);
      if (url.origin !== new URL('/', app.baseUrl).origin) throw new Error(`${url} is not on the app`);
      const headers = new Headers(init.headers);
      headers.set('cookie', (await browser.cookies()).map(c => `${c.name}=${c.value}`).join('; '));
      let body = init.body;
      if (init.json !== undefined) {
        headers.set('content-type', 'application/json');
        body = JSON.stringify(init.json);
      }
      return fetch(url, { ...init, headers, body });
    });
  },
});
