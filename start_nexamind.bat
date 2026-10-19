@echo off
title NexaMind - Notion + Microsoft Teams Unified OS
echo ===============================================================
echo               Starting NexaMind Collaboration Engine
echo ===============================================================
echo.

cd /d "%~dp0"

set "PY=python"
if exist "%~dp0backend\.venv\Scripts\python.exe" set "PY=%~dp0backend\.venv\Scripts\python.exe"

echo [1/2] Applying database migrations and starting the FastAPI backend (port 8000)...
start "NexaMind Backend" cmd /k "cd /d "%~dp0backend" && "%PY%" -m alembic upgrade head && "%PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

echo [2/2] Starting NexaMind React Frontend (Vite)...
start "NexaMind Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo ===============================================================
echo NexaMind is starting!
echo Backend:  http://127.0.0.1:8000
echo Frontend: http://localhost:5173
echo ===============================================================
echo.
timeout /t 3 >nul
start http://localhost:5173
