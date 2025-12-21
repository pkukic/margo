#!/bin/bash

# Run only the backend (for development)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR/backend"
uv run uvicorn main:app --host 127.0.0.1 --port 8765 --reload
