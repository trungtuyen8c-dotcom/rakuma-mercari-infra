PROD = docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: set-password vps-logs vps-ps up down logs ps seed-demo inspect-excel import-excel reset-db

LOCAL = docker compose -f docker-compose.yml -f docker-compose.local.yml

up: ## Local only: build from the sibling repos and start (http://localhost:8088)
	$(LOCAL) up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

set-password: ## Generate a new owner password and print it once
	docker compose exec backend set-password -generate

seed-demo: ## Load the UI prototype's sample data into an EMPTY database (dev only)
	docker compose exec backend seed-demo

inspect-excel: ## Print sheets and header rows of data/rakuma_t7.xlsx to confirm the column layout
	docker compose exec backend import-excel -inspect /data/rakuma_t7.xlsx

import-excel: ## Import data/rakuma_t7.xlsx into an EMPTY database; rolls back unless totals reconcile
	docker compose exec backend import-excel /data/rakuma_t7.xlsx

reset-db: ## DANGER: deletes all data
	docker compose down -v

vps-ps:
	ssh rakuma-vps "cd /var/www/rakuma/rakuma-mercari-infra && $(PROD) ps"

vps-logs:
	ssh rakuma-vps "cd /var/www/rakuma/rakuma-mercari-infra && $(PROD) logs -f --tail=100"
