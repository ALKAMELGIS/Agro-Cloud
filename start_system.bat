@echo off
cd /d "%~dp0"
echo ==========================================
echo      Agri Cloud System - Dev Startup
echo ==========================================
echo.
echo [1/3] Checking environment...
if not exist node_modules (
    echo Node modules not found. Installing...
    call npm.cmd install
)

echo.
echo [2/3] Starting Frontend + Backend (dev mode)...
echo Frontend: http://localhost:5173/AgroCloud/
echo Backend : http://localhost:3001
echo.
echo [3/3] Running (auto dev watch)...
echo Keep this window open to keep both servers alive.
echo.
call npm.cmd run dev:clean