#!/bin/bash

# Margo - AI PDF Reader and Annotator
# Run script for Linux

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 Starting Margo..."

# Check for required tools
if ! command -v uv &> /dev/null; then
    echo "❌ uv is not installed. Please install it first:"
    echo "   curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Install Python dependencies if needed
echo "📦 Setting up Python backend..."
cd "$SCRIPT_DIR/backend"
if [ ! -d ".venv" ]; then
    uv sync
fi

# Install Node dependencies if needed
echo "📦 Setting up Electron frontend..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    npm install
fi

# Start backend in background
echo "🐍 Starting Python backend..."
cd "$SCRIPT_DIR/backend"
uv run uvicorn main:app --host 127.0.0.1 --port 8765 &
BACKEND_PID=$!

# Wait for backend to be ready
echo "⏳ Waiting for backend to start..."
sleep 2

# Check if backend is running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Backend failed to start. Check for errors above."
    exit 1
fi

# Start Electron app
echo "🖥️  Starting Electron app..."
cd "$SCRIPT_DIR/frontend"
npm start

# Cleanup: Kill backend when frontend exits
echo "🛑 Shutting down..."
kill $BACKEND_PID 2>/dev/null || true

echo "👋 Goodbye!"
