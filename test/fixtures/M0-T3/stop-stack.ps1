# Stop the M0-T3 fixture stack started by run-stack.ps1.
$pidFile = Join-Path $PSScriptRoot 'stack-pids.json'
if (-not (Test-Path $pidFile)) { Write-Host 'no stack-pids.json'; exit 0 }
$pids = Get-Content $pidFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($id in @($pids.fablecut, $pids.adapter)) {
  if ($id) {
    try { Stop-Process -Id $id -Force -ErrorAction Stop; Write-Host "stopped $id" }
    catch { Write-Host "not running: $id" }
  }
}
