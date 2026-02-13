#!/usr/bin/env bash
PYTHON=$(cat .python_path)
exec $PYTHON -m gunicorn app:app --bind "0.0.0.0:$PORT" --workers 2 --timeout 120
