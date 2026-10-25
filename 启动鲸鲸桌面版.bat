@echo off
REM 大肥鱼桌面版一键启动
REM 直接调起 Electron 壳，由它启动内嵌服务并打开窗口
setlocal
set "ROOT=%~dp0"
start "" "%ROOT%whalegirl-desktop\大肥鱼.exe"
endlocal
