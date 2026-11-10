param([string]$InputFile,[string]$OutsideFile,[string]$OutputFile,[string]$OutsideWrite)
$ErrorActionPreference='Stop'
$result=@{inputRead=$false;outputWrite=$false;outsideRead=$false;outsideWrite=$false}
try{$null=[IO.File]::ReadAllText($InputFile);$result.inputRead=$true}catch{}
try{[IO.File]::WriteAllText($OutputFile,'CUTDIRECTOR owned isolation probe');$result.outputWrite=$true}catch{}
try{$null=[IO.File]::ReadAllText($OutsideFile);$result.outsideRead=$true}catch{}
try{[IO.File]::WriteAllText($OutsideWrite,'CUTDIRECTOR owned denied marker');$result.outsideWrite=$true}catch{}
[Console]::Write(($result|ConvertTo-Json -Compress))
