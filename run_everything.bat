@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"
set "ROOT=%CD%"

echo =============================================================
echo  PRAHARI-AI - One-Time Setup + Run
echo =============================================================
echo.

py -3.11 -c "import sys" >nul 2>&1
if errorlevel 1 (
    py -3.13 -c "import sys" >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python 3.11 or 3.13 is not installed.
        echo Install Python 3.11 or 3.13 and then run this script again.
        pause
        exit /b 1
    )
    set "PYTHON=py -3.13"
    set "PYTHON_VERSION=3.13"
) else (
    set "PYTHON=py -3.11"
    set "PYTHON_VERSION=3.11"
)

if not exist "%ROOT%\venv\Scripts\python.exe" (
    echo [*] Creating Python virtual environment...
    %PYTHON% -m venv venv
) else (
    "%ROOT%\venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if '.'.join(map(str, sys.version_info[:2])) == '%PYTHON_VERSION%' else 1)" >nul 2>&1
    if errorlevel 1 (
        echo [*] Recreating virtual environment with Python %PYTHON_VERSION%...
        rmdir /s /q "%ROOT%\venv"
        %PYTHON% -m venv venv
    )
)

call "%ROOT%\venv\Scripts\activate.bat"

echo [*] Installing Python dependencies...
pip install -r "%ROOT%\requirements.txt"

nvidia-smi >nul 2>&1
if not errorlevel 1 (
    echo [*] NVIDIA GPU detected. Installing CUDA-enabled PyTorch...
    pip install torch==2.11.0+cu128 torchvision==0.26.0+cu128 --extra-index-url https://download.pytorch.org/whl/cu128
) else (
    echo [*] No NVIDIA GPU detected. Using lightweight CPU runtime.
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js/npm is not installed or not in PATH.
    echo Install Node.js 18+ and then run this script again.
    pause
    exit /b 1
)

echo [*] Installing frontend dependencies...
cd /d "%ROOT%\frontend"
if not exist "node_modules" (
    call npm install
)

echo [*] Building frontend...
call npm run build

cd /d "%ROOT%"

echo.
echo =============================================================
echo  Starting PRAHARI-AI server...
echo  Open: http://localhost:8001
echo =============================================================
echo.
echo Configure IP cameras before starting, for example:
echo set PRAHARI_CAMERAS=[{"id":"CAM-01","name":"Gate","type":"rtsp","url":"rtsp://user:password@192.168.1.20:554/stream1","enabled":true}]
echo Multiple USB webcams use type webcam and indexes 0, 1, 2, for example:
echo set PRAHARI_CAMERAS=[{"id":"CAM-01","name":"Lobby","type":"webcam","url":0,"enabled":true},{"id":"CAM-02","name":"Desk","type":"webcam","url":1,"enabled":true}]
echo.
echo Runtime profiles: PRAHARI_PROFILE=lite (default), balanced, or high.
echo Lite profile is recommended for low-end PCs.
echo.

"%ROOT%\venv\Scripts\python.exe" main.py

pause
