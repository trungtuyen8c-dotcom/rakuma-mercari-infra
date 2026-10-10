import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

// Read-only smoke test of the live VPS: npx e2e run --config e2e.prod.config.ts
// The runner only allows plain HTTP on loopback, so it opens an SSH tunnel to the VPS nginx (alias rakuma-vps)
// and closes it after the run. Public-IP checks live in tests/prod/vps-smoke.e2e.ts (RAKUMA_PROD_HOST).
export default {
  tests: ['tests/infra.e2e.ts', 'tests/prod/**/*.e2e.ts'],
  workers: 1,
  targets: [
    {
      engine: web({ locale: 'vi-VN', timezoneId: 'Asia/Tokyo' }),
      app: {
        url: 'http://127.0.0.1:18089',
        readyUrl: 'http://127.0.0.1:18089/api/v1/auth/config',
        environment: 'production',
        command: {
          executable: 'ssh',
          args: ['-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-L', '{port}:127.0.0.1:80', 'rakuma-vps'],
          startupTimeout: 20_000,
          log: '.e2e/logs/ssh-tunnel.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
