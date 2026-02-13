#!/usr/bin/env bash
set -e
# Create venv without pip (ensurepip not available on Render)
/usr/bin/python3 -m venv --without-pip /opt/render/project/venv
# Bootstrap pip into the venv
curl -sS https://bootstrap.pypa.io/get-pip.py | /opt/render/project/venv/bin/python3
# Install dependencies
/opt/render/project/venv/bin/pip install -r requirements.txt
