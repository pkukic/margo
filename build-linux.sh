#!/bin/bash

# Margo Linux Build & Install Script
# This script builds the Electron app and installs it as a Linux application

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo "=== Margo Linux Build & Install Script ==="
echo ""

# Check for required tools
if ! command -v npm &> /dev/null; then
    echo "Error: npm is required but not installed."
    exit 1
fi

# Navigate to frontend directory
cd "$FRONTEND_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Build the application
echo "Building Margo..."
npm run build:linux

echo ""
echo "=== Build Complete ==="
echo ""

# Find the built AppImage
APPIMAGE=$(find dist -name "*.AppImage" 2>/dev/null | head -1)

if [ -n "$APPIMAGE" ]; then
    echo "AppImage created: $APPIMAGE"
    echo ""
    echo "To install the AppImage:"
    echo "  1. Make it executable: chmod +x \"$APPIMAGE\""
    echo "  2. Move to a permanent location: mv \"$APPIMAGE\" ~/.local/bin/"
    echo "  3. Run it once to integrate with desktop: ~/.local/bin/$(basename "$APPIMAGE") --appimage-extract-and-run"
    echo ""
    echo "Or for quick install to ~/.local/bin:"
    echo "  chmod +x \"$APPIMAGE\" && cp \"$APPIMAGE\" ~/.local/bin/margo.AppImage"
fi

# Find the built .deb
DEB=$(find dist -name "*.deb" 2>/dev/null | head -1)

if [ -n "$DEB" ]; then
    echo ""
    echo "Debian package created: $DEB"
    echo ""
    echo "To install the .deb package:"
    echo "  sudo dpkg -i \"$DEB\""
    echo ""
    echo "After installation, Margo will appear in your applications menu"
    echo "and you can right-click PDF files -> Open with -> Margo"
fi

echo ""
echo "=== Installation Options ==="
echo ""
echo "Option 1: Install .deb package (recommended for Debian/Ubuntu)"
echo "  sudo dpkg -i \"$DEB\""
echo ""
echo "Option 2: Use AppImage (portable, no installation required)"
echo "  chmod +x \"$APPIMAGE\""
echo "  ./\"$APPIMAGE\""
echo ""
echo "Option 3: Development mode (run from source)"
echo "  cd frontend && npm start"
