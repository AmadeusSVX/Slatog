.PHONY: install test lint format dev build typecheck

install:
	npm install
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; fi

test:
	npm test

lint:
	npm run lint

format:
	npm run format

dev:
	npm run dev

build:
	npm run build

typecheck:
	npm run typecheck
