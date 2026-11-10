#requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$outputDir = Join-Path $repoRoot 'test\fixtures\M0-T5\export-smoke'
$ffmpeg = 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffmpeg.exe'
$ffprobe = 'E:\Deepseek-product\Agent\tools\ffmpeg-4.4.1\ffprobe.exe'
$mediaRoot = 'E:\Deepseek-product\Agent\video-agent-media\M0-T1'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$commands = New-Object 'System.Collections.Generic.List[string]'
$summaries = New-Object 'System.Collections.Generic.List[string]'
$burnResult = 'Not attempted.'
$failure = $null

function Write-Utf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, $utf8)
}

# Quote each argv element using Windows CRT rules, including trailing slashes.
function Quote-Native([string]$Value) {
    '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-Media([string]$Exe, [string[]]$Argv, [string]$StdoutPath, [string]$StderrPath) {
    $nativeArgs = ($Argv | ForEach-Object { Quote-Native $_ }) -join ' '
    $displayArgs = ($Argv | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ' '
    $commands.Add("& '$Exe' $displayArgs")
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Exe
    $info.Arguments = $nativeArgs
    $info.WorkingDirectory = $outputDir
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = $utf8
    $info.StandardErrorEncoding = $utf8
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        [void]$process.Start()
        $outTask = $process.StandardOutput.ReadToEndAsync()
        $errTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $stdout = $outTask.Result
        $stderr = $errTask.Result
        $code = $process.ExitCode
        Write-Utf8 (Join-Path $outputDir $StdoutPath) $stdout
        Write-Utf8 (Join-Path $outputDir $StderrPath) $stderr
        $commands.Add("Exit code: $code; stdout: $StdoutPath; stderr: $StderrPath")
        return [pscustomobject]@{ ExitCode = $code; Stdout = $stdout; Stderr = $stderr }
    } finally { $process.Dispose() }
}

function Assert-File([string]$Name) {
    $path = Join-Path $outputDir $Name
    if (!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -le 0) {
        throw "Missing or zero-byte required output: $path"
    }
}

function Probe([string]$Path, [string]$Stem) {
    $result = Invoke-Media $ffprobe @('-v', 'error', '-show_format', '-show_streams', '-of', 'json', $Path) "$Stem.probe.json" "$Stem.probe.stderr.log"
    if ($result.ExitCode -ne 0) { throw "ffprobe failed for $Path : $($result.Stderr)" }
    Assert-File "$Stem.probe.json"
    $probe = $result.Stdout | ConvertFrom-Json
    $video = @($probe.streams | Where-Object codec_type -eq 'video')
    $audio = @($probe.streams | Where-Object codec_type -eq 'audio')
    $summary = "$Stem : duration=$($probe.format.duration)s; bytes=$($probe.format.size)"
    foreach ($v in $video) { $summary += "; video=$($v.codec_name) $($v.width)x$($v.height) fps=$($v.avg_frame_rate)" }
    foreach ($a in $audio) { $summary += "; audio=$($a.codec_name) channels=$($a.channels) layout=$($a.channel_layout) sample_rate=$($a.sample_rate) bitrate=$($a.bit_rate)" }
    $summaries.Add($summary)
    return $probe
}

function Assert-Export($Probe, [string]$Name, [double]$ExpectedDuration, [double]$Tolerance) {
    $video = @($Probe.streams | Where-Object codec_type -eq 'video')
    $audio = @($Probe.streams | Where-Object codec_type -eq 'audio')
    if ($video.Count -ne 1 -or $audio.Count -ne 1) { throw "$Name must contain one video and one audio stream." }
    $duration = [double]::Parse($Probe.format.duration, [Globalization.CultureInfo]::InvariantCulture)
    if ([Math]::Abs($duration - $ExpectedDuration) -gt $Tolerance) { throw "$Name duration $duration is outside tolerance $Tolerance of $ExpectedDuration." }
    if ($video[0].codec_name -ne 'h264' -or $video[0].width -ne 360 -or $video[0].height -ne 720 -or $audio[0].codec_name -ne 'aac' -or $audio[0].channels -ne 1) {
        throw "$Name codec, resolution or audio validation failed."
    }
}

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
try {
    foreach ($exe in @($ffmpeg, $ffprobe)) { if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Tool missing: $exe" } }
    $inputFile = Get-ChildItem -LiteralPath $mediaRoot -Filter 'A-01original*.mp4' -Recurse -File | Select-Object -First 1
    if ($null -eq $inputFile) { throw "No A-01original*.mp4 under $mediaRoot" }
    Write-Host "Input: $($inputFile.FullName)"
    $inputProbe = Probe $inputFile.FullName 'a01'
    $common = @('-hide_banner', '-nostdin', '-y', '-i', $inputFile.FullName)
    $encode = @('-map', '0:v:0', '-map', '0:a:0', '-vf', 'scale=360:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart')
    $result = Invoke-Media $ffmpeg ($common + $encode + @('a01.proxy.mp4')) 'a01.proxy.stdout.log' 'a01.proxy.stderr.log'
    if ($result.ExitCode -ne 0) { throw "Proxy encoding failed: $($result.Stderr)" }
    Assert-File 'a01.proxy.mp4'
    $proxyProbe = Probe (Join-Path $outputDir 'a01.proxy.mp4') 'a01.proxy'
    Assert-Export $proxyProbe 'proxy' 57.613 0.5
    $result = Invoke-Media $ffmpeg ($common + @('-ss', '0', '-t', '5') + $encode + @('a01.clip5.mp4')) 'a01.clip5.stdout.log' 'a01.clip5.stderr.log'
    if ($result.ExitCode -ne 0) { throw "Clip encoding failed: $($result.Stderr)" }
    Assert-File 'a01.clip5.mp4'
    $clipProbe = Probe (Join-Path $outputDir 'a01.clip5.mp4') 'a01.clip5'
    Assert-Export $clipProbe 'clip' 5 0.2
    $cueText = 'M0-T5 ' + [char]0x5bfc + [char]0x51fa + ' smoke'
    Write-Utf8 (Join-Path $outputDir 'a01.srt') "1`r`n00:00:00,000 --> 00:00:05,000`r`n$cueText`r`n"
    Assert-File 'a01.srt'
    $burnResult = 'Failed before completion; see failure details.'
    $result = Invoke-Media $ffmpeg @('-hide_banner', '-nostdin', '-y', '-i', 'a01.clip5.mp4', '-map', '0:v:0', '-map', '0:a:0', '-vf', 'subtitles=filename=a01.srt:charenc=UTF-8', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', 'a01.clip5.burned.mp4') 'a01.clip5.burned.stdout.log' 'a01.clip5.burned.stderr.log'
    if ($result.ExitCode -ne 0) {
        $burnResult = "FAILED (exit $($result.ExitCode)). Sidecar a01.srt retained. Exact error in a01.clip5.burned.stderr.log:`r`n`r`n``````text`r`n$($result.Stderr)`r`n``````"
        # A failed native command may leave an unusable partial MP4.
        $partial = Join-Path $outputDir 'a01.clip5.burned.mp4'
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    } else {
        Assert-File 'a01.clip5.burned.mp4'
        $burnProbe = Probe (Join-Path $outputDir 'a01.clip5.burned.mp4') 'a01.clip5.burned'
        Assert-Export $burnProbe 'burned clip' 5 0.2
        $burnResult = 'SUCCESS: subtitles filter completed; burned MP4 passed ffprobe validation. Sidecar retained.'
    }
} catch {
    $failure = $_.Exception.Message
} finally {
    $status = if ($null -eq $failure) { 'PASS' } else { 'FAIL' }
    $lines = @('# M0-T5 A-01 export smoke', '', "Status: $status", "Generated: $([DateTimeOffset]::Now.ToString('o'))", "Output directory: $outputDir", "Input: $($inputFile.FullName)", '', '## Verification', '', 'Proxy duration tolerance: 57.613 +/- 0.5 seconds; clip: 5 +/- 0.2 seconds.', 'Required exports: nonzero H.264 360x720 video plus mono AAC audio.', '')
    $lines += $summaries.ToArray()
    $lines += @('', '## Subtitle burn', '', $burnResult, '', '## Failure', '', "$failure", '', '## Exact PowerShell commands', '', "Working directory for every command: $outputDir", '', '```powershell')
    $lines += $commands.ToArray()
    $lines += @('```', '', '## Output inventory', '', 'SHA256SUMS.txt covers all produced files (including this report and diagnostic logs), except the manifest itself, which cannot hash itself. Empty stdout/stderr logs are normal; required media, subtitle and probe outputs must be nonzero.', '', '| Absolute path | Bytes |', '| --- | ---: |')
    foreach ($file in (Get-ChildItem -LiteralPath $outputDir -File | Where-Object Name -NotIn @('report.md', 'SHA256SUMS.txt') | Sort-Object Name)) {
        $lines += "| $($file.FullName) | $($file.Length) |"
    }
    # Include the report's own size without a self-referential size mismatch.
    $reportPath = Join-Path $outputDir 'report.md'
    $baseReport = ($lines -join "`r`n") + "`r`n"
    $size = 0L
    do {
        $previousSize = $size
        $report = $baseReport + "| $reportPath | $size |`r`n"
        $size = $utf8.GetByteCount($report)
    } while ($size -ne $previousSize)
    Write-Utf8 $reportPath $report
    $hashLines = @(Get-ChildItem -LiteralPath $outputDir -File | Where-Object Name -ne 'SHA256SUMS.txt' | Sort-Object Name | ForEach-Object {
        "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
    })
    Write-Utf8 (Join-Path $outputDir 'SHA256SUMS.txt') (($hashLines -join "`r`n") + "`r`n")
}
if ($null -ne $failure) { throw $failure }
Write-Host "PASS: $outputDir"
Write-Host $burnResult
$summaries | ForEach-Object { Write-Host $_ }
