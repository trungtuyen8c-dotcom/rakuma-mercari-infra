# rakuma-mercari-infra

## Deploy to the VPS

- Target: 222.255.181.169 (Ubuntu 24.04). SSH alias `rakuma-vps`, user `deploy`, key only. Root and password login are off, `ufw` allows only 22, 80 and 443, and fail2ban watches sshd.
- Deploys go through GitHub only. Merging a PR into `main` of the backend or frontend repo runs its `Deploy` workflow: test, push an image to GHCR, tag `vX.Y.Z`, then `scripts/release.sh` on the VPS (swap one service, health-check, roll back on failure). Merging into this repo copies the compose, nginx and script files and reconciles the stack. `make vps-ps` and `make vps-logs` show status and logs.
- Manual rollback: `ssh rakuma-vps /var/www/rakuma/rakuma-mercari-infra/scripts/release.sh backend v0.1.0`. Log in to GHCR first if the image is not cached.
- Server-only files: `/var/www/rakuma/rakuma-mercari-infra/.env` holds the DB password, APP_URL, APP_ENV=production, OAuth keys, and the BACKEND_TAG/WEB_TAG pins. Deploys never overwrite it.
- Sign-in is the owner email + password. To reset the password: `ssh rakuma-vps`, then `cd /var/www/rakuma/rakuma-mercari-infra && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend set-password -generate`. Five wrong passwords lock that IP out for 15 minutes.
- Excel import on the server: `scp rakuma_t7.xlsx rakuma-vps:/var/www/rakuma/rakuma-mercari-infra/data/`, then `ssh rakuma-vps` and run `cd /var/www/rakuma/rakuma-mercari-infra && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend import-excel /data/rakuma_t7.xlsx`.
- The site is plain HTTP on the IP, so avoid public Wi-Fi. With a domain (a free one such as sslip.io works too) you can add HTTPS and, optionally, Google OAuth keys.

## Local (optional)

Docker Compose for the whole system: Postgres, the Go API, and the web app (nginx serving the SPA and proxying `/api`). It expects the sibling repos `../rakuma-mercari-backend` and `../rakuma-mercari-frontend`.

```sh
cp .env.example .env   # optional; defaults work for local use
make up                # http://localhost:8088
make seed-demo         # sample data, empty DB only
make logs / make down
```

## Importing the Excel file

1. Copy `rakuma_t7.xlsx` into `data/`. The folder is git-ignored.
2. Run `make inspect-excel` and check that the column layout matches the defaults. See the backend README.
3. Run `make import-excel`. It works on an empty database only, and nothing is saved unless the totals reconcile.

## Google sign-in

1. Create an OAuth client ID (Web application) in Google Cloud Console.
2. Add the authorized redirect URI `$APP_URL/api/v1/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`, then run `make up`.

Only `RAKUMA_OWNER_EMAIL` can sign in. Set `APP_ENV=production` to turn dev login off.

Ports: web 8088 and Postgres 127.0.0.1:55432. Change them with `WEB_PORT` and `DB_PORT`. `make reset-db` deletes all data.
