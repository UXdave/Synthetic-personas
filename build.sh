#!/usr/bin/env bash
set -e
pip install -r requirements.txt
# Save absolute paths so the start script can find them at runtime
which python3 > .python_path 2>/dev/null || which python > .python_path
