#!/usr/bin/env bash
set -e
# Use Render's build-time pip (which works) but install into a directory
# inside the project source so packages persist to runtime.
pip install --target ./vendor -r requirements.txt
