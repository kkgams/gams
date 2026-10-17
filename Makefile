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

.PHONY: run app-check app-test app-run app-build-release app-bundle-release app-icons game-icons-check serve-docs validate-docs clean

# Deliberately independent: this checks Host Rust/Tauri source without sibling repos.
app-check: app-icons
	cd "$(TAURI_SRC_DIR)"
	CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo check

# Legacy source-monorepo fixture tests are explicitly ignored, not silently passed.
app-test: app-icons
	node --test test/*.test.mjs
	cd "$(TAURI_SRC_DIR)"
	CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo test

app-icons:
	mkdir -p "$(BUILD_DIR)/app/icons"
	cd "$(TAURI_SRC_DIR)"
	cargo tauri icon "$(abspath $(TAURI_APP_DIR)/brand/icon.svg)" -o "$(abspath $(BUILD_DIR)/app/icons)"

# Build/run from source. An omitted Project opens the native folder picker.
run: app-run

app-run: app-icons
	if [[ -n "$(GAMS_APP_CWD)" ]]; then
	  [[ -f "$(GAMS_APP_CWD)/gams.json" ]] || { echo 'GAMS_APP_CWD must point to a Project root with gams.json' >&2; exit 1; }
	  export GAMS_APP_CWD="$$(cd "$(GAMS_APP_CWD)" && pwd -P)"
	else
	  unset GAMS_APP_CWD
	fi
	cd "$(TAURI_SRC_DIR)"
	CC="$(HOST_CC)" CXX="$(HOST_CXX)" CARGO_TARGET_DIR="$(TAURI_TARGET_DIR)" cargo tauri dev

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

$(GAME_ICONS_BUILD)/downloads/$(GAME_ICONS_REVISION).tar.gz:
	mkdir -p "$(@D)"
	curl --fail --location --retry 3 "https://codeload.github.com/game-icons/icons/tar.gz/$(GAME_ICONS_REVISION)" -o "$@.tmp"
	mv "$@.tmp" "$@"

$(GAME_ICONS_SOURCE)/.ready: $(GAME_ICONS_BUILD)/downloads/$(GAME_ICONS_REVISION).tar.gz
	rm -rf "$(@D).tmp"
	mkdir -p "$(@D).tmp"
	tar -xzf "$<" --strip-components=1 -C "$(@D).tmp"
	test -f "$(@D).tmp/license.txt"
	rm -rf "$(@D)"
	mv "$(@D).tmp" "$(@D)"
	touch "$@"

$(GAME_ICONS_BUILD)/tooling/.ready: scripts/game-icons/package.json scripts/game-icons/package-lock.json
	mkdir -p "$(@D)"
	cp scripts/game-icons/package.json scripts/game-icons/package-lock.json "$(@D)/"
	npm ci --ignore-scripts --no-audit --no-fund --prefix "$(@D)"
	touch "$@"

$(GAME_ICONS_BUILD)/prepared/.ready: $(GAME_ICONS_SOURCE)/.ready scripts/game-icons/prepare.py scripts/game-icons/source.mk
	rm -rf "$(@D).tmp"
	python3 scripts/game-icons/prepare.py "$(GAME_ICONS_SOURCE)" "$(@D).tmp" "$(GAME_ICONS_REVISION)"
	rm -rf "$(@D)"
	mv "$(@D).tmp" "$(@D)"
	touch "$@"

$(GAME_ICONS_BUILD)/python/.ready: scripts/game-icons/requirements.txt
	python3 -m venv "$(@D)"
	"$(@D)/bin/pip" install --disable-pip-version-check -r "$<"
	touch "$@"

$(GAME_ICONS_BUILD)/generated/.ready: $(GAME_ICONS_BUILD)/prepared/.ready $(GAME_ICONS_BUILD)/tooling/.ready $(GAME_ICONS_BUILD)/python/.ready scripts/game-icons/build.mjs scripts/game-icons/finish.py
	rm -rf "$(@D).tmp"
	node scripts/game-icons/build.mjs "$(GAME_ICONS_BUILD)/prepared" "$(GAME_ICONS_BUILD)/tooling" "$(@D).tmp" "$(GAME_ICONS_BUILD)/python/bin/python"
	rm -rf "$(@D)"
	mv "$(@D).tmp" "$(@D)"
	touch "$@"

game-icons-check: cmd/app/src/fonts/game-icons.woff2 $(GAME_ICONS_BUILD)/python/.ready
	python3 -m unittest discover -s test -p test_game_icons.py
	node --test test/game-icons-target.test.mjs
	"$(GAME_ICONS_BUILD)/python/bin/python" scripts/game-icons/finish.py --check cmd/app/src/fonts/game-icons.woff2 cmd/app/src/fonts/game-icons.json

# Delegate installation/serving/validation to the upstream wiki Makefile.
# Versioned cache paths avoid reusing an engine from a different release.
WIKI_REPOSITORY ?= https://github.com/justgook/wiki
WIKI_VERSION ?= v1.4.0
WIKI_MAKEFILE ?= $(BUILD_DIR)/wiki-$(WIKI_VERSION).mk
WIKI_ENGINE ?= $(BUILD_DIR)/wiki-$(WIKI_VERSION)
PORT ?= 8080

$(WIKI_MAKEFILE):
	mkdir -p "$(@D)"
	curl --fail --location --retry 3 "$(WIKI_REPOSITORY)/raw/$(WIKI_VERSION)/Makefile" -o "$@.tmp"
	mv "$@.tmp" "$@"

docs/assets/game-icons.woff2: cmd/app/src/fonts/game-icons.woff2
	mkdir -p "$(@D)"
	cp "$<" "$@.tmp"
	mv "$@.tmp" "$@"

serve-docs validate-docs: $(WIKI_MAKEFILE) docs/assets/game-icons.woff2
	@if [[ "$(abspath $(WIKI_ENGINE))" != "$(abspath $(BUILD_DIR)/wiki-$(WIKI_VERSION))" ]]; then
	  test -f "$(WIKI_ENGINE)/scripts/serve.mjs" || { echo "Wiki engine not found: $(WIKI_ENGINE)" >&2; exit 1; }
	fi
	$(MAKE) -f "$(WIKI_MAKEFILE)" "$(patsubst %-docs,%,$@)" WIKI_REPOSITORY="$(WIKI_REPOSITORY)" WIKI_VERSION="$(WIKI_VERSION)" WIKI_ENGINE="$(WIKI_ENGINE)" WIKI_SOURCE="$(abspath docs)" PORT="$(PORT)"

clean:
	rm -rf "$(BUILD_DIR)"
	rm -f docs/assets/game-icons.woff2
