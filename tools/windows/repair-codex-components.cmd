@echo off
setlocal
chcp 65001 >nul
title CUTDIRECTOR Windows component repair
"%SystemRoot%\System32\fltmc.exe" >nul 2>&1
if errorlevel 1 (
 echo 此工具需要管理员权限。尚未执行修复。
 exit /b 740
)
if not exist "%~dp0component-repair-logs" mkdir "%~dp0component-repair-logs"
if not exist "%~dp0component-repair-logs" exit /b 1
echo 正在检查并修复 Windows 组件。不会自动重启电脑。
"%SystemRoot%\System32\Dism.exe" /Online /Cleanup-Image /RestoreHealth /NoRestart /LogPath:"%~dp0component-repair-logs\dism-detail.log" >"%~dp0component-repair-logs\dism-console.log" 2>&1
set "CD_DISM_RESULT=%errorlevel%"
>"%~dp0component-repair-logs\dism-exit.txt" echo %CD_DISM_RESULT%
if not "%CD_DISM_RESULT%"=="0" if not "%CD_DISM_RESULT%"=="3010" (
 echo Windows 组件修复未完成，请查看日志；未继续执行系统文件修复。
 exit /b 1
)
echo 正在检查并修复系统文件，请等待完成。
"%SystemRoot%\System32\sfc.exe" /scannow >"%~dp0component-repair-logs\sfc-console.log" 2>&1
set "CD_SFC_RESULT=%errorlevel%"
>"%~dp0component-repair-logs\sfc-exit.txt" echo %CD_SFC_RESULT%
echo 修复工具已经结束。仍需重新检查 Codex 隔离与出图能力。
echo 没有调用模型，没有自动重启。
exit /b %CD_SFC_RESULT%
