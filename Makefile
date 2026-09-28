SHELL := bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c
.DELETE_ON_ERROR:
MAKEFLAGS += --no-builtin-rules --warn-undefined-variables

BUILD_DIR ?= build.nosync
TAURI_APP_DIR := cmd/app
TAURI_SRC_DIR := $(TAURI_APP_DIR)/src-tauri
TAURI_TARGET_DIR ?= $(if $(value CARGO_TARGET_DIR),$(abspath $(value CARGO_TARGET_DIR)),$(abspath $(BUILD_DIR)/app/target))
APP_BUNDLES ?= app
GAMS_APP_CWD ?=
HOST_CC_AUTO := $(shell if [ -x /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang ]; then echo /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang; else command -v clang || command -v cc; fi)
HOST_CXX_AUTO := $(shell if [ -x /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++ ]; then echo /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++; else command -v clang++ || command -v c++; fi)
HOST_CC ?= $(if $(CC),$(CC),$(HOST_CC_AUTO))
HOST_CXX ?= $(if $(CXX),$(CXX),$(HOST_CXX_AUTO))

.PHONY: app-check app-test app-run app-build-release app-bundle-release app-icons clean

# Deliberately independent: this checks Host Rust/Tauri source without sibling repos.
app-check: app-icons
	cd "$(TAURI_SRC_DIR)"
	CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo check

# Legacy source-monorepo fixture tests are explicitly ignored, not silently passed.
app-test: app-icons
	cd "$(TAURI_SRC_DIR)"
	CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo test

app-icons:
	mkdir -p "$(BUILD_DIR)/app/icons"
	cd "$(TAURI_SRC_DIR)"
	cargo tauri icon "$(abspath $(TAURI_APP_DIR)/brand/icon.svg)" -o "$(abspath $(BUILD_DIR)/app/icons)"

# An external Project must be selected explicitly, never silently defaulted.
app-run: app-icons
	[[ -n "$(GAMS_APP_CWD)" && -f "$(GAMS_APP_CWD)/gams.json" ]] || { echo 'Set GAMS_APP_CWD to an external Project root with gams.json' >&2; exit 1; }
	cd "$(TAURI_SRC_DIR)"
	GAMS_APP_CWD="$(GAMS_APP_CWD)" CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo tauri dev

# The desktop Host is independent of any particular Project.
app-build-release: app-icons
	cd "$(TAURI_SRC_DIR)"
	CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo tauri build --no-bundle

# Tauri bundles DMG before post-bundle dependency repair, so it must not be
# produced until a separate verified DMG pipeline exists.
app-bundle-release: app-icons
	[[ "$(APP_BUNDLES)" == app ]] || { echo 'Only the checked app bundle is supported; DMG bundling would capture the uncorrected binary' >&2; exit 1; }
	( cd "$(TAURI_SRC_DIR)"
	  CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo tauri build --bundles "$(APP_BUNDLES)" )
	bash scripts/portabilize-mac-bundle.sh "$(TAURI_TARGET_DIR)/release/bundle/macos/GAMS.app"

clean:
	rm -rf "$(BUILD_DIR)"
