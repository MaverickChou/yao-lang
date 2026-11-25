@echo off
rem Yao (爻) launcher for Windows.
rem   yao              -> REPL
rem   yao cast         -> cast a hexagram
rem   yao eval "..."   -> evaluate an expression
rem   yao test         -> run self-check
rem
rem This file is intentionally ASCII-only: cmd.exe reads .cmd in the system
rem ANSI codepage, so non-ASCII text here would corrupt parsing.

chcp 65001 >nul 2>nul

setlocal
set "NODE="

if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE=node"
)

if not defined NODE (
  echo.
  echo [yao] Node.js not found.
  echo       Install from https://nodejs.org/  or drop node.exe into "%~dp0runtime\"
  echo.
  exit /b 1
)

"%NODE%" "%~dp0bin\yao.js" %*
exit /b %errorlevel%
