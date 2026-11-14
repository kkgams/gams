SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := build
ROOT := ../..
OUTPUT := $(ROOT)/build.nosync/browser-jco
PORT ?= 8093

.PHONY: build serve test clean
build:
	python3 build.py

test:
	node --test *.test.mjs

# Standard-library static GET/HEAD server: no conversion endpoints or subprocesses.
serve: build
	python3 -m http.server $(PORT) --bind 127.0.0.1 --directory $(OUTPUT)/site

# Reuse the Host's guarded deletion: refuses tracked paths and symlink traversal.
clean:
	cd $(ROOT) && python3 scripts/package-host.py clean build.nosync/browser-jco
