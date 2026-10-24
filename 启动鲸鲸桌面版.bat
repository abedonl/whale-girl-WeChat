@echo off
REM 鲸鲸桌面版一键启动
REM 直接调起 Electron 壳，由它启动内嵌服务并打开窗口
setlocal
set "ROOT=%~dp0"
start "" "%ROOT%鲸鲸桌面版\鲸鲸.exe"
endlocal
