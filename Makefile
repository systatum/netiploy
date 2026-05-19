APP := netiploy
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null | sed 's/^v//' || echo dev)
BUILD_DIR := build
LDFLAGS := -s -w -X main.version=$(VERSION)
GO ?= go
GO_ENV := GOCACHE=$(CURDIR)/.cache/go-build GOMODCACHE=$(CURDIR)/.cache/go-mod

.PHONY: all clean test test-unit test-e2e build build-bin-all \
	build-bin-linux-x64 build-bin-linux-arm64 \
	build-bin-mac-x64 build-bin-mac-arm64 \
	build-bin-win-x64 build-bin-win-arm64 checksums

all: build-bin-all

clean:
	rm -rf $(BUILD_DIR)

test: test-unit test-e2e

test-unit:
	$(GO_ENV) $(GO) test ./...

test-e2e:
	@set -e; \
	docker compose up -d; \
	trap 'docker compose down' EXIT; \
	NETIPLOY_E2E=1 $(GO_ENV) $(GO) test -count=1 -tags=e2e ./internal/netiploy

build:
	mkdir -p $(BUILD_DIR)
	$(GO_ENV) $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(APP) ./cmd/netiploy

build-bin-all: clean build-bin-linux-x64 build-bin-linux-arm64 build-bin-mac-x64 build-bin-mac-arm64 build-bin-win-x64 build-bin-win-arm64

build-bin-linux-x64:
	mkdir -p $(BUILD_DIR)
	$(GO_ENV) GOOS=linux GOARCH=amd64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(APP)-linux-x64 ./cmd/netiploy

build-bin-linux-arm64:
	mkdir -p $(BUILD_DIR)
	$(GO_ENV) GOOS=linux GOARCH=arm64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(APP)-linux-arm64 ./cmd/netiploy

build-bin-mac-x64:
	mkdir -p $(BUILD_DIR)
	$(GO_ENV) GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(APP)-macos-x64 ./cmd/netiploy

build-bin-mac-arm64:
	mkdir -p $(BUILD_DIR)
	$(GO_ENV) GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(APP)-macos-arm64 ./cmd/netiploy

build-bin-win-x64:
	mkdir -p $(BUILD_DIR)
	$(GO_ENV) GOOS=windows GOARCH=amd64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(APP)-win-x64.exe ./cmd/netiploy

build-bin-win-arm64:
	mkdir -p $(BUILD_DIR)
	$(GO_ENV) GOOS=windows GOARCH=arm64 CGO_ENABLED=0 $(GO) build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(APP)-win-arm64.exe ./cmd/netiploy

checksums: build-bin-all
	cd $(BUILD_DIR) && sha256sum \
		$(APP)-linux-x64 \
		$(APP)-linux-arm64 \
		$(APP)-macos-x64 \
		$(APP)-macos-arm64 \
		$(APP)-win-x64.exe \
		$(APP)-win-arm64.exe \
		> checksums.txt
