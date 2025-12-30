#!/bin/bash

# Install script for Margo - PDF Q&A with AI

echo "Installing Margo"
echo "================"

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed. Please install uv first:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed. Please install Node.js and npm first."
    exit 1
fi

echo "uv found: $(uv --version)"
echo "npm found: $(npm --version)"

# Build using the existing build script
echo ""
echo "Building Margo..."
./build-linux.sh

echo ""
echo "Installation complete!"
echo ""
echo "Usage:"
echo "  ./run.sh"
echo "  or install the .deb package from the dist/ directory"
echo ""
