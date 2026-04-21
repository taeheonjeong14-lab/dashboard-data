@echo off
setlocal
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "PROFILE=C:\Projects\chrome-profiles\80aed9be-9de1-4d52-bbcc-1e1f7bab7540"
if not exist "%PROFILE%" mkdir "%PROFILE%"
echo Starting Chrome debug port 7000, profile: %PROFILE%
start "" "%CHROME%" --user-data-dir="%PROFILE%" --remote-debugging-port=7000
