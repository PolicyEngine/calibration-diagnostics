.PHONY: frontend backend install-frontend install-backend

install-frontend:
	cd frontend && bun install

install-backend:
	pip install -e .

frontend:
	cd frontend && NEXT_PUBLIC_USE_FIXTURES=true bun run dev

backend:
	uvicorn backend.app:app --reload --port 8000
