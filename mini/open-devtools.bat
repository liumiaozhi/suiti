@echo off
REM ============================================================
REM  SuiTi Mini Program - open in WeChat DevTools
REM  ASCII-only on purpose: no chcp, no delayed expansion.
REM  (chcp 65001 / enabledelayedexpansion break the DevTools CLI.)
REM ============================================================
setlocal

set "PROJ=D:\dev\suiti-mini"
set "IDE="

for %%R in ("D:\Program Files (x86)\Tencent" "C:\Program Files (x86)\Tencent" "C:\Program Files\Tencent" "D:\Program Files\Tencent") do (
  if not defined IDE if exist "%%~R" (
    for /d %%D in ("%%~R\*") do (
      if not defined IDE if exist "%%~D\cli.bat" set "IDE=%%~D"
    )
  )
)

if not defined IDE (
  echo [ERROR] WeChat DevTools not found under the usual install paths.
  echo         Install it first, or set IDE manually in this file.
  pause
  exit /b 1
)

if not exist "%PROJ%\project.config.json" (
  echo [ERROR] Project not found: %PROJ%
  pause
  exit /b 1
)

echo IDE     : %IDE%
echo Project : %PROJ%
echo.
echo Opening project in DevTools...
echo If it asks you to log in, choose "tourist mode" to preview the UI.
echo.

call "%IDE%\cli.bat" open --project "%PROJ%"

echo.
echo Done. If no window appeared, open DevTools manually and use
echo "Import project" to select: %PROJ%
pause
