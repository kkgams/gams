SHELL := bash
.ONESHELL:
.SHELLFLAGS := -eu -o pipefail -c
.DELETE_ON_ERROR:
MAKEFLAGS += --no-builtin-rules --warn-undefined-variables
.DEFAULT_GOAL := run

BUILD_DIR ?= build.nosync
export TMPDIR := $(abspath $(BUILD_DIR)/tmp)
export TMP := $(TMPDIR)
export TEMP := $(TMPDIR)
export PYTHONPYCACHEPREFIX := $(abspath $(BUILD_DIR)/pycache)
# CI supplies the triggering tag's version; local builds retain source metadata.
RELEASE_VERSION ?=
TAURI_VERSION_CONFIG = $(if $(strip $(RELEASE_VERSION)),{"version":"$(RELEASE_VERSION)"},{})
TAURI_VERSION_ARGS = $(if $(strip $(RELEASE_VERSION)),--config '$(TAURI_VERSION_CONFIG)')
TAURI_APP_DIR := cmd/app
TAURI_SRC_DIR := $(TAURI_APP_DIR)/src-tauri
TAURI_TARGET_DIR ?= $(if $(value CARGO_TARGET_DIR),$(abspath $(value CARGO_TARGET_DIR)),$(abspath $(BUILD_DIR)/app/target))
# Recursive: docs/promo/font commands never need Rust installed.
TARGET ?= $(shell rustc -vV 2>/dev/null | awk '/^host:/ {print $$2}')
GAMS_CONFIG ?= gams.json
export GAMS_CONFIG
GAMS_APP_CWD ?=
HOST_CC_AUTO = $(shell if [ -x /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang ]; then echo /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang; else command -v clang || command -v cc || true; fi)
HOST_CXX_AUTO = $(shell if [ -x /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++ ]; then echo /Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/clang++; else command -v clang++ || command -v c++ || true; fi)
HOST_CC ?= $(if $(CC),$(CC),$(HOST_CC_AUTO))
HOST_CXX ?= $(if $(CXX),$(CXX),$(HOST_CXX_AUTO))
# MSVC discovers its compiler through the native developer environment.
COMPILER_ENV = case "$$(uname -s)" in MINGW*|MSYS*|CYGWIN*) unset CC CXX ;; *) if [[ -n "$(HOST_CC)" ]]; then export CC="$(HOST_CC)"; fi; if [[ -n "$(HOST_CXX)" ]]; then export CXX="$(HOST_CXX)"; fi ;; esac

.PHONY: run open test build package app-icons game-icons-check docs serve-docs validate-docs promo serve-promo clean

$(BUILD_DIR)/tmp:
	mkdir -p "$@"

# Order-only: creating the shared temporary directory never invalidates outputs.
run open test build package app-icons game-icons-check docs serve-docs validate-docs promo serve-promo: | $(BUILD_DIR)/tmp

# Source development: no Project means the existing native picker behavior.
run: app-icons
	case "$$GAMS_CONFIG" in
	  ''|.|..|*/*|*\\*) echo 'GAMS_CONFIG must be a non-empty filename within the Project directory' >&2; exit 1 ;;
	esac
	if [[ -n "$(GAMS_APP_CWD)" ]]; then
	  [[ -f "$(GAMS_APP_CWD)/$$GAMS_CONFIG" ]] || { echo "GAMS_APP_CWD must point to a Project root with $$GAMS_CONFIG" >&2; exit 1; }
	  export GAMS_APP_CWD="$$(cd "$(GAMS_APP_CWD)" && pwd -P)"
	else
	  unset GAMS_APP_CWD
	fi
	$(COMPILER_ENV)
	cd "$(TAURI_SRC_DIR)"
	CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo tauri dev

# Open this checkout's root Project, not the picker or an inherited Project.
open:
	$(MAKE) run GAMS_APP_CWD="$(CURDIR)" GAMS_CONFIG=gams.json

test: app-icons
	node --test test/*.test.mjs
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -p 'test_*.py'
	$(COMPILER_ENV)
	cd "$(TAURI_SRC_DIR)"
	CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo test

app-icons: $(BUILD_DIR)/app/icons/icon.icns

$(BUILD_DIR)/app/icons/icon.icns: $(TAURI_APP_DIR)/brand/icon.svg Makefile | $(BUILD_DIR)/tmp
	mkdir -p "$(@D)"
	cd "$(TAURI_SRC_DIR)"
	cargo tauri icon "$(abspath $(TAURI_APP_DIR)/brand/icon.svg)" -o "$(abspath $(BUILD_DIR)/app/icons)"

# Expand native targets only for native build goals, so docs require no rustc.
ifneq ($(filter build package $(BUILD_DIR)/GAMS-% $(BUILD_DIR)/SHA256SUMS-%,$(MAKECMDGOALS)),)
ifeq ($(strip $(TARGET)),)
$(error Cannot determine native Rust target; activate the development shell or set TARGET explicitly)
endif
PLATFORM_aarch64-apple-darwin := macos-aarch64
PLATFORM_x86_64-pc-windows-msvc := windows-x86_64
PLATFORM_x86_64-unknown-linux-gnu := linux-x86_64
PLATFORM = $(if $(filter $(TARGET),aarch64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu),$(PLATFORM_$(TARGET)),unsupported)
NATIVE_BINARY := $(TAURI_TARGET_DIR)/$(TARGET)/release/gams$(if $(findstring windows,$(TARGET)),.exe)
NATIVE_INPUTS := $(shell find cmd/app/src-tauri cmd/app/src cmd/app/brand cmd/app/wit ! -name .DS_Store)

# Re-evaluate options each invocation, preserving mtime when they are unchanged.
NATIVE_OPTIONS := $(BUILD_DIR)/app/release-options-$(TARGET).json
.PHONY: force-native-options
force-native-options:

$(NATIVE_OPTIONS): force-native-options | $(BUILD_DIR)/tmp
	mkdir -p "$(@D)"
	printf '%s\n' '$(TAURI_VERSION_CONFIG)' > "$@.tmp"
	if ! cmp -s "$@.tmp" "$@"; then mv "$@.tmp" "$@"; else rm "$@.tmp"; fi

build: $(NATIVE_BINARY)

$(NATIVE_BINARY): $(NATIVE_INPUTS) $(BUILD_DIR)/app/icons/icon.icns $(NATIVE_OPTIONS) Makefile | $(BUILD_DIR)/tmp
	if [[ "$(TARGET)" == *windows* ]]; then unset CC CXX; else $(COMPILER_ENV); fi
	cd "$(TAURI_SRC_DIR)"
	CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo tauri build --no-bundle --target "$(TARGET)" $(TAURI_VERSION_ARGS)
	# Cargo can reuse unchanged bytes after a Makefile-only change.
	touch "$@"

ifeq ($(PLATFORM),unsupported)
package:
	@echo 'Unsupported package TARGET=$(TARGET); supported: aarch64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu' >&2
	exit 1
else
ARCHIVE := $(BUILD_DIR)/GAMS-$(PLATFORM).$(if $(findstring linux,$(PLATFORM)),tar.gz,zip)
NATIVE_NOTICES := $(BUILD_DIR)/native-notices/$(TARGET)/NATIVE-NOTICES.md
NATIVE_SOURCE_README := $(BUILD_DIR)/native-notices/$(TARGET)/NATIVE-SOURCE/README.md
NOTICE_INPUTS := LICENSE NOTICE $(shell find cmd/app/src/fonts cmd/app/src/util cmd/app/src/widgets -type f ! -name .DS_Store)
PACKAGE_BINARY := $(NATIVE_BINARY)
ifeq ($(TARGET),aarch64-apple-darwin)
PACKAGE_BINARY := $(TAURI_TARGET_DIR)/$(TARGET)/release/bundle/macos/GAMS.app/Contents/MacOS/gams
$(PACKAGE_BINARY): $(NATIVE_BINARY) $(NATIVE_OPTIONS) scripts/portabilize-mac-bundle.sh | $(BUILD_DIR)/tmp
	cd "$(TAURI_SRC_DIR)"
	CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo tauri bundle --bundles app --target "$(TARGET)" $(TAURI_VERSION_ARGS)
	cd "$(CURDIR)"
	bash scripts/portabilize-mac-bundle.sh "$(TAURI_TARGET_DIR)/$(TARGET)/release/bundle/macos/GAMS.app"
	# Bundling can preserve the executable's older timestamp.
	touch "$@"
endif

$(NATIVE_NOTICES) $(NATIVE_SOURCE_README) &: $(TAURI_SRC_DIR)/Cargo.lock $(TAURI_SRC_DIR)/Cargo.toml native-about.toml scripts/build-native-notices.py scripts/generate-native-notices.py | $(BUILD_DIR)/tmp
	python3 scripts/build-native-notices.py --target "$(TARGET)" --output "$(NATIVE_NOTICES)"

package: $(ARCHIVE) $(BUILD_DIR)/SHA256SUMS-$(PLATFORM)

$(ARCHIVE): $(PACKAGE_BINARY) $(NATIVE_NOTICES) $(NATIVE_SOURCE_README) $(NOTICE_INPUTS) scripts/package-host.py Makefile | $(BUILD_DIR)/tmp
	python3 scripts/package-host.py package --target "$(TARGET)" --binary "$(if $(filter aarch64-apple-darwin,$(TARGET)),$(TAURI_TARGET_DIR)/$(TARGET)/release/bundle/macos/GAMS.app,$(NATIVE_BINARY))" --native-notices "$(NATIVE_NOTICES)" --output "$@"

$(BUILD_DIR)/SHA256SUMS-$(PLATFORM): $(ARCHIVE) scripts/package-host.py | $(BUILD_DIR)/tmp
	python3 scripts/package-host.py checksum "$<" "$@"
endif
endif

# The checked-in font is the completion marker. No prerequisites here on purpose:
# a checkout (even after `make clean`) must not download/install/rebuild tooling.
# Remove this file explicitly to regenerate it and its catalogue/metadata.
include scripts/game-icons/source.mk
GAME_ICONS_BUILD := $(BUILD_DIR)/game-icons
GAME_ICONS_SOURCE := $(GAME_ICONS_BUILD)/source-$(GAME_ICONS_REVISION)

cmd/app/src/fonts/game-icons.woff2:
	$(MAKE) "$(GAME_ICONS_BUILD)/generated/.ready"
	cp "$(GAME_ICONS_BUILD)/generated/game-icons.json" cmd/app/src/fonts/game-icons.json
	cp "$(GAME_ICONS_BUILD)/generated/GAME-ICONS-PROVENANCE.md" cmd/app/src/fonts/GAME-ICONS-PROVENANCE.md
	cp "$(GAME_ICONS_BUILD)/generated/game-icons.contributors.txt" cmd/app/src/fonts/licenses/game-icons.contributors.txt
	cp "$(GAME_ICONS_BUILD)/generated/game-icons.md" docs/game-icons.md
	cp "$(GAME_ICONS_BUILD)/generated/game-icons.woff2" "$@.tmp"
	mv "$@.tmp" "$@"

$(GAME_ICONS_BUILD)/downloads/$(GAME_ICONS_REVISION).tar.gz: | $(BUILD_DIR)/tmp
	mkdir -p "$(@D)"
	curl --fail --location --retry 3 "https://codeload.github.com/game-icons/icons/tar.gz/$(GAME_ICONS_REVISION)" -o "$@.tmp"
	mv "$@.tmp" "$@"

$(GAME_ICONS_SOURCE)/.ready: $(GAME_ICONS_BUILD)/downloads/$(GAME_ICONS_REVISION).tar.gz | $(BUILD_DIR)/tmp
	rm -rf "$(@D).tmp"
	mkdir -p "$(@D).tmp"
	tar -xzf "$<" --strip-components=1 -C "$(@D).tmp"
	test -f "$(@D).tmp/license.txt"
	rm -rf "$(@D)"
	mv "$(@D).tmp" "$(@D)"
	touch "$@"

# Optional native asset compiler only; ordinary builds use the checked-in font.
$(GAME_ICONS_BUILD)/tooling/node_modules: flake.nix flake.lock scripts/game-icons/package.json scripts/game-icons/package-lock.json | $(BUILD_DIR)/tmp
	mkdir -p "$(GAME_ICONS_BUILD)"
	nix build .#game-icons-tooling --out-link "$(abspath $(GAME_ICONS_BUILD)/tooling)"

$(GAME_ICONS_BUILD)/prepared/.ready: $(GAME_ICONS_SOURCE)/.ready scripts/game-icons/prepare.py scripts/game-icons/source.mk | $(BUILD_DIR)/tmp
	rm -rf "$(@D).tmp"
	python3 scripts/game-icons/prepare.py "$(GAME_ICONS_SOURCE)" "$(@D).tmp" "$(GAME_ICONS_REVISION)"
	rm -rf "$(@D)"
	mv "$(@D).tmp" "$(@D)"
	touch "$@"

$(GAME_ICONS_BUILD)/generated/.ready: $(GAME_ICONS_BUILD)/prepared/.ready $(GAME_ICONS_BUILD)/tooling/node_modules scripts/game-icons/build.mjs scripts/game-icons/finish.py | $(BUILD_DIR)/tmp
	rm -rf "$(@D).tmp"
	# Use the Python environment supplied by the pinned development shell.
	python=$$(command -v python3)
	node scripts/game-icons/build.mjs "$(GAME_ICONS_BUILD)/prepared" "$(GAME_ICONS_BUILD)/tooling" "$(@D).tmp" "$$python"
	rm -rf "$(@D)"
	mv "$(@D).tmp" "$(@D)"
	touch "$@"

game-icons-check: cmd/app/src/fonts/game-icons.woff2
	PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s test -p test_game_icons.py
	node --test test/game-icons-target.test.mjs
	python=$$(command -v python3)
	"$$python" scripts/game-icons/finish.py --check cmd/app/src/fonts/game-icons.woff2 cmd/app/src/fonts/game-icons.json

# Delegate to the pinned wiki engine; all assembly/cache output stays disposable.
WIKI_REPOSITORY ?= https://github.com/justgook/wiki
WIKI_VERSION ?= v1.4.0
WIKI_MAKEFILE ?= $(BUILD_DIR)/wiki-$(WIKI_VERSION).mk
WIKI_ENGINE ?= $(BUILD_DIR)/wiki-$(WIKI_VERSION)
PORT ?= 8080
DOCS_PORT ?= $(PORT)
PROMO_PORT ?= 8081
DOCS_OUTPUT ?= $(BUILD_DIR)/docs
DOCS_SOURCE := $(BUILD_DIR)/docs-source
DOCS_INPUTS := $(wildcard docs/.) $(shell if test -d docs; then find docs -mindepth 1 ! -name .DS_Store; fi)

$(WIKI_MAKEFILE): | $(BUILD_DIR)/tmp
	mkdir -p "$(@D)"
	curl --fail --location --retry 3 "$(WIKI_REPOSITORY)/raw/$(WIKI_VERSION)/Makefile" -o "$@.tmp"
	mv "$@.tmp" "$@"

$(DOCS_SOURCE)/.ready: $(DOCS_INPUTS) cmd/app/src/fonts/game-icons.woff2 Makefile | $(BUILD_DIR)/tmp
	python3 scripts/package-host.py clean "$(DOCS_SOURCE)"
	mkdir -p "$(DOCS_SOURCE)"
	cp -R docs/. "$(DOCS_SOURCE)/"
	mkdir -p "$(DOCS_SOURCE)/assets"
	cp cmd/app/src/fonts/game-icons.woff2 "$(DOCS_SOURCE)/assets/"
	touch "$@"

docs serve-docs validate-docs: $(WIKI_MAKEFILE) $(DOCS_SOURCE)/.ready
	@if [[ "$(abspath $(WIKI_ENGINE))" != "$(abspath $(BUILD_DIR)/wiki-$(WIKI_VERSION))" ]]; then
	  test -f "$(WIKI_ENGINE)/scripts/serve.mjs" || { echo "Wiki engine not found: $(WIKI_ENGINE)" >&2; exit 1; }
	fi
	$(MAKE) -f "$(WIKI_MAKEFILE)" "$(if $(filter docs,$@),build,$(patsubst %-docs,%,$@))" WIKI_REPOSITORY="$(WIKI_REPOSITORY)" WIKI_VERSION="$(WIKI_VERSION)" WIKI_ENGINE="$(WIKI_ENGINE)" WIKI_SOURCE="$(abspath $(DOCS_SOURCE))" WIKI_OUTPUT="$(abspath $(DOCS_OUTPUT))" PORT="$(DOCS_PORT)"

serve-promo:
	python3 scripts/serve-promo.py --port "$(PROMO_PORT)" --docs-port "$(DOCS_PORT)"

# Publish static promo and assembled docs; never publish the source tree.
promo:
	mkdir -p "$(BUILD_DIR)"
	stage=$$(mktemp -d "$(abspath $(BUILD_DIR))/.site.XXXXXX")
	trap 'rm -rf "$$stage"' EXIT
	$(MAKE) docs DOCS_OUTPUT="$$stage/wiki"
	mkdir "$$stage/site"
	cp -R promo/. "$$stage/site/"
	cp -RL "$$stage/wiki" "$$stage/site/docs"
	touch "$$stage/site/.nojekyll"
	python3 scripts/package-host.py clean "$(BUILD_DIR)/site"
	mv "$$stage/site" "$(BUILD_DIR)/site"
	@echo 'Built Pages site: $(BUILD_DIR)/site'

# Tauri's fixed SDK schema location is an owner-approved output exception.
TAURI_SCHEMA_FILES := $(addprefix $(TAURI_SRC_DIR)/gen/schemas/,acl-manifests.json capabilities.json desktop-schema.json macOS-schema.json windows-schema.json linux-schema.json)

# Only declared recreatable outputs; unrelated files/logs under build.nosync stay.
# Tracked paths and symlink ancestors are refused before deleting anything.
clean:
	python3 scripts/package-host.py clean "$(BUILD_DIR)/app" "$(BUILD_DIR)/game-icons" "$(BUILD_DIR)/native-notices" "$(BUILD_DIR)/tmp" "$(BUILD_DIR)/pycache" "$(DOCS_SOURCE)" "$(BUILD_DIR)/docs" "$(BUILD_DIR)/site" "$(BUILD_DIR)/wiki-$(WIKI_VERSION)" "$(BUILD_DIR)/wiki-$(WIKI_VERSION).mk" $(foreach platform,macos-aarch64 windows-x86_64 linux-x86_64,"$(BUILD_DIR)/GAMS-$(platform).$(if $(findstring linux,$(platform)),tar.gz,zip)" "$(BUILD_DIR)/SHA256SUMS-$(platform)") $(foreach schema,$(TAURI_SCHEMA_FILES),"$(schema)")
