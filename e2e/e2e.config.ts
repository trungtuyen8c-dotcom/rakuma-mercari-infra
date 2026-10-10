import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

// The stack is started by ./run.sh (Docker Compose, isolated project "rakuma-e2e"), not by the runner.
export default {
  tests: ['tests/**/*.e2e.ts', '!tests/prod/**'],
  workers: 1, // tests share one database; periods.e2e.ts closes a month
  targets: [
    {
      engine: web({ locale: 'vi-VN', timezoneId: 'Asia/Tokyo' }),
      app: { url: process.env.RAKUMA_E2E_URL ?? 'http://localhost:18088', environment: 'test' },
    },
  ],
  credentials: {
    owner: { username: 'chushop.rakuma@gmail.com', password: process.env.RAKUMA_E2E_PASSWORD ?? '' },
  },
} satisfies E2EConfig;
