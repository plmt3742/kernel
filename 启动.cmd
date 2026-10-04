@echo off
chcp 65001 >nul
setlocal
rem KERNEL 双击启动器（仓库开发 / 分发包 通用）
set "KERNEL_NODE=%~dp0runtime\node.exe"
if exist "%KERNEL_NODE%" goto run
where node >nul 2>nul
if errorlevel 1 goto nonode
set "KERNEL_NODE=node"
:run
"%KERNEL_NODE%" "%~dp0scripts\launcher.mjs"
exit /b %errorlevel%
:nonode
echo.
echo [KERNEL] Node.js not found. / 未检测到 Node.js
echo The bundled app should contain runtime\node.exe; otherwise install Node.js 18+.
echo 分发包应包含 runtime\node.exe；否则请安装 Node.js 18+（https://nodejs.org/）。
echo.
pause
exit /b 1
