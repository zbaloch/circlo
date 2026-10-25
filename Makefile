.PHONY: dev test test-core test-server test-app core-android scan

dev:
	./infra/dev-up.sh

test: test-core test-server test-app

test-core:
	@if [ -f core/Cargo.toml ]; then cd core && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test; else echo "core/: nothing to test yet"; fi

test-server:
	cd server && mvn -B verify

test-app:
	@if [ -f app/package.json ]; then cd app && npm run typecheck && npm run lint && npm test; else echo "app/: nothing to test yet"; fi

# Cross-compile the Rust core for Android (needs cargo-ndk and the Android NDK).
core-android:
	cd core && cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o ../app/modules/halqo-core/android/src/main/jniLibs build --release

scan:
	pre-commit run --all-files
	gitleaks git --redact --verbose .
