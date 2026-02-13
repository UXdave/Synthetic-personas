#!/usr/bin/env bash
set -e
# Install packages into a vendor directory that persists to runtime.
# Render's runtime does NOT carry over build-time site-packages.
pip install --target ./vendor -r requirements.txt
# Save the Python binary path so start.sh can find it at runtime.
python3 -c "import sys; print(sys.executable)" > .python_path
