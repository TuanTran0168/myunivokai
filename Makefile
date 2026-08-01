# --env-file is mandatory, not decorative: Compose only auto-loads a file named
# `.env`, so without this the root `.env.local` is ignored and every service
# silently falls back to the compose-file defaults.
DOCKER_COMPOSE := docker compose --env-file .env.local -f docker-compose-local.yaml
.DEFAULT_GOAL := local-up

.PHONY: local-up local-up-detached local-down local-logs local-status

local-up:
	$(DOCKER_COMPOSE) up --build --remove-orphans

local-up-detached:
	$(DOCKER_COMPOSE) up --build --detach --remove-orphans

local-down:
	$(DOCKER_COMPOSE) down --remove-orphans

local-logs:
	$(DOCKER_COMPOSE) logs --follow

local-status:
	$(DOCKER_COMPOSE) ps
