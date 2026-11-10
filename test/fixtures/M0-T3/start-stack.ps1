# M0-T3 fixture stack: FableCut engine + single-writer adapter.
# Not product code. Run from the repository root.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$repo = Join-Path $env:TEMP 'dsd-m0t2-audit\FableCut_sparse'
if (-not (Test-Path (Join-Path $repo 'server.js'))) {
  throw "FableCut checkout not found at $repo. Recreate the M0-T2 clone first."
}
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Force $data | Out-Null
$logDir = Join-Path $env:TEMP 'dsh-m0t3-logs'
New-Item -ItemType Directory -Force $logDir | Out-Null

$env:FABLECUT_DATA_DIR = $data
$env:FABLECUT_NO_FS_WATCH = '1'
$env:PORT = '7790'
$p1 = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $repo -PassThru `
  -RedirectStandardOutput (Join-Path $logDir 'fablecut.out.log') `
  -RedirectStandardError (Join-Path $logDir 'fablecut.err.log')

$env:DATA_DIR = $data
$env:PROJECT_ID = 'P'
$env:FABLECUT_BASE_URL = 'http://127.0.0.1:7790'
$env:ADAPTER_PORT = '7792'
$adapter = Join-Path (Resolve-Path (Join-Path $root '..\..\..')).Path 'test\spikes\g0-1\writer-adapter.js'
$p2 = Start-Process -FilePath 'node' -ArgumentList $adapter -WorkingDirectory (Resolve-Path (Join-Path $root '..\..\..')).Path -PassThru `
  -RedirectStandardOutput (Join-Path $logDir 'adapter.out.log') `
  -RedirectStandardError (Join-Path $logDir 'adapter.err.log')

@{ fablecut = $p1.Id; adapter = $p2.Id; data = $data; startedAt = (Get-Date).ToString('o') } |
  ConvertTo-Json | Set-Content (Join-Path $root 'stack-pids.json') -Encoding UTF8

Start-Sleep -Seconds 3
"fablecut pid=$($p1.Id) exited=$($p1.HasExited)"
"adapter pid=$($p2.Id) exited=$($p2.HasExited)"
try { (Invoke-WebRequest 'http://127.0.0.1:7792/health' -UseBasicParsing -TimeoutSec 5).Content } catch { "health failed: $($_.Exception.Message)" }
