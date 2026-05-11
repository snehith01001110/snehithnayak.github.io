#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESUME_DIR="$ROOT_DIR/resume-latex"
TEX_FILE="$RESUME_DIR/resume.tex"
PUBLIC_PDF="$ROOT_DIR/resume.pdf"

if ! command -v pdflatex >/dev/null 2>&1; then
  export PATH="/Library/TeX/texbin:/usr/local/texlive/2026/bin/universal-darwin:/usr/local/texlive/2025/bin/universal-darwin:$PATH"
fi

if ! command -v pdflatex >/dev/null 2>&1; then
  echo "Error: pdflatex is not installed or is not on PATH." >&2
  exit 1
fi

if [[ ! -f "$TEX_FILE" ]]; then
  echo "Error: missing $TEX_FILE" >&2
  exit 1
fi

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

pdflatex -interaction=nonstopmode -halt-on-error -output-directory="$BUILD_DIR" "$TEX_FILE"
pdflatex -interaction=nonstopmode -halt-on-error -output-directory="$BUILD_DIR" "$TEX_FILE"
cp "$BUILD_DIR/resume.pdf" "$PUBLIC_PDF"

echo "Built $PUBLIC_PDF"
