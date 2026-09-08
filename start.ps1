# Brolly Juniors B2C — start the whole stack.
#
# Run this from your own terminal:   .\start.ps1
#
# Servers started here belong to YOUR shell, not to a Claude Code session, so
# they keep running after any agent session ends. Close the two windows it
# opens (or press Ctrl+C in each) to stop them.
#
#   -Dev    run Next with hot-reload instead of the production build
#           (heavier: ~230 MB vs ~75 MB, which matters on this machine)
#   -Seed   drop, migrate and re-seed the database before starting

param(
    [switch]$Dev,
    [switch]$Seed
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$python = Join-Path $root 'backend\.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
    Write-Host "No virtualenv found. Create it first:" -ForegroundColor Yellow
    Write-Host "  cd backend; py -3 -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}

# --- data services ---------------------------------------------------------
Write-Host "`nStarting Postgres (5542) and Redis (6479)..." -ForegroundColor Cyan
docker compose -f (Join-Path $root 'docker-compose.yml') up -d
if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker is not running. Start Docker Desktop and try again." -ForegroundColor Yellow
    exit 1
}

Write-Host "Waiting for Postgres to report healthy..." -NoNewline
for ($i = 0; $i -lt 40; $i++) {
    $h = docker inspect --format '{{.State.Health.Status}}' brolly_b2c_postgres 2>$null
    if ($h -eq 'healthy') { break }
    Start-Sleep -Seconds 2
    Write-Host "." -NoNewline
}
Write-Host " ok" -ForegroundColor Green

# --- optional reseed -------------------------------------------------------
if ($Seed) {
    Write-Host "`nResetting and seeding the database..." -ForegroundColor Cyan
    & $python (Join-Path $root 'backend\scripts\reset.py')
    & $python (Join-Path $root 'backend\scripts\migrate.py')
    & $python (Join-Path $root 'backend\scripts\seed.py')
}

# --- api -------------------------------------------------------------------
Write-Host "`nStarting FastAPI on 8000..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$root\backend'; & '$python' -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
)

# --- web -------------------------------------------------------------------
$webCmd = if ($Dev) { 'npm run dev' } else { 'npm start' }
if (-not $Dev -and -not (Test-Path (Join-Path $root 'frontend\.next\BUILD_ID'))) {
    Write-Host "No production build yet — building once (about a minute)..." -ForegroundColor Cyan
    Push-Location (Join-Path $root 'frontend')
    npm run build
    Pop-Location
}

Write-Host "Starting Next.js on 3000 ($(if ($Dev) { 'dev' } else { 'production' }) mode)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    '-NoExit', '-Command',
    "Set-Location '$root\frontend'; $webCmd"
)

Write-Host @"

  Brolly Juniors B2C is starting.

    Web        http://localhost:3000     <- open this
    API        http://127.0.0.1:8000     (proxied via /api, do not open directly)
    API docs   http://127.0.0.1:8000/docs
    Postgres   localhost:5542
    Redis      localhost:6479

  Sign in with:
    admin\@brollyjuniors.com / brolly          Brolly admin
    sneha.reddy\@brollyjuniors.com / brolly    Teacher
    aarav\@example.com / learn                 Student, both courses
    sana\@example.com / learn                  Student, AI only

  Give the web server a few seconds, then open http://localhost:3000

"@ -ForegroundColor Green
