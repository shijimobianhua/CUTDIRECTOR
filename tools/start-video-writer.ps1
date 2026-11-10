# Start the local Video-agent writer used by the DSH workbench.
# Keep this window open while using the Video-agent page.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$env:PORT = '7793'
$env:VIDEO_DATA = Join-Path $root '.m1-data'
$env:FFMPEG = 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffmpeg.exe'
$env:FFPROBE = 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe'
Set-Location $root
Write-Host "Video-agent writer: http://127.0.0.1:$env:PORT/"
Write-Host "Data: $env:VIDEO_DATA"
node src/server.cjs
