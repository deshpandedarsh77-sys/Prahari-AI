<#
.SYNOPSIS
    PRAHARI-AI Multi-Camera Intelligent Surveillance Platform PowerShell Launcher
.DESCRIPTION
    Launches PRAHARI-AI 4-camera real-time surveillance server and automatically opens
    the command center web interface at http://localhost:8001.
#>

$ErrorActionPreference = "Continue"

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host " PRAHARI-AI — Multi-Camera AI Surveillance Command Center" -ForegroundColor Yellow
Write-Host "==============================================================================" -ForegroundColor Cyan

# Set project root to script directory
Set-Location -Path $PSScriptRoot
$projectRoot = Get-Location
Write-Host "[*] Project Root: $projectRoot" -ForegroundColor Gray

# Step 1: Check Python
try {
    $pyVersion = python --version 2>&1
    Write-Host "[*] Python Environment: $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Python was not found in PATH. Please ensure Python is installed and accessible." -ForegroundColor Red
    exit 1
}

# Step 2: Check GPU CUDA
try {
    $gpuStatus = python -c "import torch; print(f'CUDA GPU ({torch.cuda.get_device_name(0)})' if torch.cuda.is_available() else 'CPU Fallback')" 2>&1
    Write-Host "[*] AI Acceleration: $gpuStatus" -ForegroundColor Green
} catch {
    Write-Host "[!] Could not probe PyTorch CUDA device." -ForegroundColor Yellow
}

Write-Host "[*] Runtime profile: $($(if ($env:PRAHARI_PROFILE) { $env:PRAHARI_PROFILE } else { 'lite' }))" -ForegroundColor Green

# Step 3 & 4: Check React Frontend Build
$distIndex = Join-Path $projectRoot "frontend\dist\index.html"
if (-not (Test-Path $distIndex)) {
    Write-Host "[*] Production React build not found. Probing Node.js environment..." -ForegroundColor Yellow
    try {
        $nodeVersion = node --version 2>&1
        Write-Host "[*] Node.js Environment: $nodeVersion" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Node.js / npm is required to build the React frontend!" -ForegroundColor Red
        Write-Host "Please install Node.js (v18+) and re-run." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[*] Building React + Vite production assets..." -ForegroundColor Gray
    Set-Location -Path (Join-Path $projectRoot "frontend")
    if (-not (Test-Path "node_modules")) {
        Write-Host "[*] Installing npm dependencies..." -ForegroundColor Gray
        npm install
    }
    npm run build
    Set-Location -Path $projectRoot

    if (-not (Test-Path $distIndex)) {
        Write-Host "[ERROR] React production build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "[+] React production build generated successfully." -ForegroundColor Green
} else {
    Write-Host "[*] Production React Frontend: Verified ($distIndex)" -ForegroundColor Green
}

# Step 5: Camera sources are supplied through PRAHARI_CAMERAS.
Write-Host "[*] Camera sources: PRAHARI_CAMERAS JSON (RTSP/IP cameras)" -ForegroundColor Gray
if (-not $env:PRAHARI_CAMERAS) {
    Write-Host "    [!] No cameras configured. Set PRAHARI_CAMERAS before starting." -ForegroundColor Yellow
} else {
    Write-Host "    [+] Configured RTSP/IP cameras and USB webcams will start independently." -ForegroundColor Green
}

Write-Host "`n==============================================================================" -ForegroundColor Cyan
Write-Host " Starting Server on http://localhost:8001 (Press Ctrl+C to stop)" -ForegroundColor Yellow
Write-Host "==============================================================================`n" -ForegroundColor Cyan

# Open browser after 3 seconds in background job
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:8001"
} | Out-Null

# Execute main server
python main.py
