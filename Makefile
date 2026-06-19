.PHONY: dev test lint migrate seed

dev:
	npm run dev

test:
	npm run test

lint:
	npm run lint

migrate:
	npm run prisma:migrate

seed:
	npm run prisma:seed
