#!/usr/bin/env bash
set -e
# Create a venv using the system python3 (which is available at runtime)
/usr/bin/python3 -m venv /opt/render/project/venv
# Install dependencies into the venv
/opt/render/project/venv/bin/pip install -r requirements.txt
