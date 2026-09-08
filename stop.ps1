# Brolly Juniors B2C — stop the stack.
#
#   .\stop.ps1            stop the app servers, leave Postgres and Redis up
#   .\stop.ps1 -All       also stop the containers (data is kept in volumes)

param([switch]$All)

$root = $PSScriptRoot

function Stop-Port($port, $label) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $conns) { Write-Host "  $label ($port) was not running"; return }
    foreach ($pid in ($conns.OwningProcess | Select-Object -Unique)) {
        try {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-Host "  stopped $label ($port), pid $pid" -ForegroundColor Green
        } catch {
            Write-Host "  could not stop pid $pid on $port : $_" -ForegroundColor Yellow
        }
    }
}

Write-Host "`nStopping app servers..." -ForegroundColor Cyan
Stop-Port 3000 'Next.js'
Stop-Port 8000 'FastAPI'

if ($All) {
    Write-Host "`nStopping containers (volumes are kept, so data survives)..." -ForegroundColor Cyan
    docker compose -f (Join-Path $root 'docker-compose.yml') stop
} else {
    Write-Host "`nPostgres and Redis left running. Use -All to stop them too." -ForegroundColor DarkGray
}
