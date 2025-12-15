#!/usr/bin/env bash
set -euo pipefail

python -m scraper_agent "${1:-https://techcivita9365.builtwithrocket.new/about-us}" --out-dir "${2:-./scrape_out}" --max-pages "${3:-200}" --max-depth "${4:-4}"
