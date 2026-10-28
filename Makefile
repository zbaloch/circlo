.PHONY: dev test test-core test-server test-app core-android core-android-release core-ios scan

dev:
	./infra/dev-up.sh

test: test-core test-server test-app

test-core:
	@if [ -f core/Cargo.toml ]; then cd core && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test; else echo "core/: nothing to test yet"; fi

test-server:
	cd server && mvn -B verify

test-app:
	@if [ -f app/package.json ]; then cd app && npm run typecheck && npm run lint && npm test; else echo "app/: nothing to test yet"; fi

# Build the Rust core for Android and regenerate @circlo/core (needs cargo-ndk, ANDROID_NDK_HOME).
core-android:
	cd app/modules/circlo-core && npm run ubrn:android

# Optimised library for release builds and performance checks (Cargo profile "app").
core-android-release:
	cd app/modules/circlo-core && npm run ubrn:android:release

# Build the Rust core for iOS (needs a Mac with Xcode, or run in EAS).
core-ios:
	cd app/modules/circlo-core && npm run ubrn:ios

scan:
	pre-commit run --all-files
	gitleaks git --redact --verbose .
