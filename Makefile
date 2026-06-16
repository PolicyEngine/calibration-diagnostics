.PHONY: install dev build test typecheck

install:
	cd frontend && bun install

dev:
	cd frontend && bun run dev

build:
	cd frontend && bun run build

typecheck:
	cd frontend && bun run lint

test:
	cd frontend && bun test
