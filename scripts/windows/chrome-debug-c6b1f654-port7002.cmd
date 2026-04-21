@echo off
setlocal
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "PROFILE=C:\Projects\chrome-profiles\c6b1f654-c70d-4ba9-afe9-db4a06099d28"
if not exist "%PROFILE%" mkdir "%PROFILE%"
echo Starting Chrome debug port 7002, profile: %PROFILE%
start "" "%CHROME%" --user-data-dir="%PROFILE%" --remote-debugging-port=7002
