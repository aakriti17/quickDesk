#!/usr/bin/env bash
# ============================================================
# QuickDesk - Linux / macOS Startup Script
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/backend"

echo "============================================================"
echo "  🖥️  QuickDesk - Instant Remote Screen & Desktop Control"
echo "============================================================"
echo ""

# Check Python command (python3 or python)
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
else
    echo "❌ Error: Python 3 is not installed or not in PATH."
    exit 1
fi

# Check dependencies
echo "🔍 Checking dependencies..."
$PYTHON_CMD -c "import fastapi, uvicorn, pyautogui, qrcode" >/dev/null 2>&1 || {
    echo "📦 Installing requirements..."
    $PYTHON_CMD -m pip install -r requirements.txt
}

echo ""
echo "🚀 Starting QuickDesk on port 9000..."
echo "🌐 Open your browser at: http://localhost:9000"
echo "Press Ctrl+C to terminate."
echo ""

# Open browser if possible
if command -v xdg-open >/dev/null 2>&1; then
    (sleep 2 && xdg-open "http://localhost:9000") &
elif command -v open >/dev/null 2>&1; then
    (sleep 2 && open "http://localhost:9000") &
fi

exec $PYTHON_CMD run.py
