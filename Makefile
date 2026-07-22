DOCKER_COMPOSE := docker compose -f docker-compose-local.yml
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
