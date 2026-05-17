#!/usr/bin/env bash

set -euo pipefail

REPO="systatum/netiploy"
BINARY_NAME="netiploy"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)
    PLATFORM="linux"
    ;;
  Darwin)
    PLATFORM="macos"
    ;;
  *)
    echo "Unsupported operating system: $OS"
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64)
    ARCH_NAME="x64"
    ;;
  arm64|aarch64)
    if [ "$PLATFORM" = "linux" ]; then
      ARCH_NAME="arm64"
    else
      ARCH_NAME="arm64"
    fi
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

ASSET_NAME="${BINARY_NAME}-${PLATFORM}-${ARCH_NAME}"

LATEST_TAG="$(
  curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name":' \
    | sed -E 's/.*"([^"]+)".*/\1/'
)"

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${LATEST_TAG}/${ASSET_NAME}"

INSTALL_DIR="/usr/local/bin"
TMP_FILE="$(mktemp)"

echo "Installing ${BINARY_NAME}"
echo "Detected platform: ${PLATFORM}"
echo "Detected architecture: ${ARCH_NAME}"
echo "Latest release: ${LATEST_TAG}"
echo "Downloading: ${DOWNLOAD_URL}"

curl -fL "$DOWNLOAD_URL" -o "$TMP_FILE"

chmod +x "$TMP_FILE"

sudo mkdir -p "$INSTALL_DIR"
sudo mv "$TMP_FILE" "${INSTALL_DIR}/${BINARY_NAME}"

echo
echo "Installed to ${INSTALL_DIR}/${BINARY_NAME}"
echo

"${INSTALL_DIR}/${BINARY_NAME}" --version || true
