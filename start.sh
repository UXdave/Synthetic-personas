#!/usr/bin/env bash
export PYTHONPATH="${PWD}/vendor"
# Use the Python path saved at build time; fall back to python3 on PATH.
PYTHON=$(cat .python_path 2>/dev/null || which python3 2>/dev/null || echo python3)
exec "$PYTHON" -m gunicorn app:app --bind "0.0.0.0:${PORT:-5000}" --workers 2 --timeout 120 --preload
