.PHONY: dev test test-server test-app web scan

dev:
	./infra/dev-up.sh

test: test-server test-app

test-server:
	cd server && mvn -B verify

test-app:
	cd app && npm run typecheck && npm run lint && npm test

# The web app (app.hellocirclo.com) as static files in app/dist.
web:
	cd app && npm run build:web

scan:
	pre-commit run --all-files
	gitleaks git --redact --verbose .
