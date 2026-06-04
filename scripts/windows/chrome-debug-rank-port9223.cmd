@echo off
setlocal
REM 키워드 순위(블로그/플레이스) 전용 비로그인 디버그 Chrome.
REM 로그인 프로필과 분리된 별도 user-data-dir 사용 → 계정 탐지 리스크 없음.
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
set "PROFILE=C:\Projects\chrome-profiles\rank-nologin-9223"
if not exist "%PROFILE%" mkdir "%PROFILE%"
echo Starting Chrome debug port 9223 (rank, non-login), profile: %PROFILE%
start "" "%CHROME%" --user-data-dir="%PROFILE%" --remote-debugging-port=9223
