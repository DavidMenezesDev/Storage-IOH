COMPOSE      = docker compose
COMPOSE_DEV  = docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help hooks env up down logs dev dev-down test test-go test-web lint build

help: ## Lista os comandos
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

hooks: ## Ativa a validação de mensagens de commit e o template .gitmessage
	git config core.hooksPath .githooks
	git config commit.template .gitmessage
	@echo "Hooks ativados."

env: ## Cria o .env com segredos aleatórios (se ainda não existir)
	@if [ -f .env ]; then echo ".env já existe"; else \
		sed -e "s/^APP_SECRET=.*/APP_SECRET=$$(openssl rand -hex 32)/" \
		    -e "s/^MEILI_MASTER_KEY=.*/MEILI_MASTER_KEY=$$(openssl rand -hex 24)/" \
		    -e "s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=$$(openssl rand -hex 8)/" \
		    .env.example > .env; \
		echo ".env criado. Login inicial:"; grep -E '^ADMIN_(EMAIL|PASSWORD)' .env; fi

up: env ## Sobe tudo (produção)
	$(COMPOSE) up -d --build

down: ## Para tudo
	$(COMPOSE) down

logs: ## Acompanha os logs
	$(COMPOSE) logs -f --tail=100

dev: env ## Sobe com MinIO + dados de exemplo e API exposta em 127.0.0.1:8080
	$(COMPOSE_DEV) up -d --build

dev-down: ## Para o ambiente de dev
	$(COMPOSE_DEV) down

test: test-go test-web ## Roda todos os testes

test-go: ## Testes do backend
	cd backend && go vet ./... && go test ./...

test-web: ## Lint + build do frontend
	cd web && pnpm lint && pnpm build

build: ## Builda as imagens
	$(COMPOSE) build
