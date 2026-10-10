import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

test.setup('owner signs in with email and password', { sessions: ['owner'] }, async ({ app, screen, session }) => {
  const owner = credentials.user('owner');
  await app.open('/');
  await expect(screen.getByRole('heading', 'Đăng nhập')).toBeVisible();
  await screen.getByLabel('Email').fill(owner.username);
  await screen.getByLabel('Mật khẩu').fill(owner.password);
  await screen.getByRole('button', 'Đăng nhập').tap();
  await expect(screen.getByRole('heading', 'Tổng quan', { level: 1 })).toBeVisible();
  await session.save('owner');
});
