@echo off
setlocal enabledelayedexpansion

title QuickDesk - Remote Desktop Platform
cls

echo ============================================================
echo   🖥️  QuickDesk - Instant Remote Screen ^& Desktop Control
echo ============================================================
echo.

:: Check for Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.10 or higher from https://python.org
    pause
    exit /b 1
)

:: Set Working Directory to Backend
cd /d "%~dp0backend"

:: Verify requirements
echo [*] Checking Python dependencies...
python -c "import fastapi, uvicorn, pyautogui, qrcode" >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Installing required Python packages...
    python -m pip install -r requirements.txt
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo.
echo [*] Starting QuickDesk Server on port 9000...
echo [*] Web UI will be available at: http://localhost:9000
echo [*] Press Ctrl+C in this terminal to stop the server.
echo.

:: Launch browser in background after 2 seconds
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:9000"

:: Start Uvicorn / Backend
python run.py

pause
