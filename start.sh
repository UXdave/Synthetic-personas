#!/usr/bin/env bash
# Point the system python3 (only python available at runtime) at the
# vendor directory where build-time pip installed our packages.
export PYTHONPATH="${PWD}/vendor"
exec /usr/bin/python3 -m gunicorn app:app --bind "0.0.0.0:$PORT" --workers 2 --timeout 120
