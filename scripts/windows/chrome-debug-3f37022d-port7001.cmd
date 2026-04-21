@echo off
setlocal
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "PROFILE=C:\Projects\chrome-profiles\3f37022d-d32d-43f5-a672-5abe36e74361"
if not exist "%PROFILE%" mkdir "%PROFILE%"
echo Starting Chrome debug port 7001, profile: %PROFILE%
start "" "%CHROME%" --user-data-dir="%PROFILE%" --remote-debugging-port=7001
