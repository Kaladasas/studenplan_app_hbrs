@echo off
setlocal

echo ========================================
echo Python Anwendung wird gestartet
echo ========================================
echo.

REM Prüfen, ob .venv bereits existiert
if not exist ".venv\Scripts\python.exe" (
echo [INFO] .venv wurde nicht gefunden.
echo [INFO] Erstelle virtuelle Umgebung...
python -m venv .venv

if errorlevel 1 (
    echo [FEHLER] Die virtuelle Umgebung konnte nicht erstellt werden.
    pause
    exit /b 1
)


) else (
echo [INFO] .venv ist bereits vorhanden.
)

echo.
echo [INFO] Installiere/aktualisiere Abhaengigkeiten...
.venv\Scripts\python.exe -m pip install -r requirements.txt

if errorlevel 1 (
echo.
echo [FEHLER] Installation der Abhaengigkeiten fehlgeschlagen.
pause
exit /b 1
)

echo.
echo [INFO] Starte app.py...
echo.

.venv\Scripts\python.exe app.py

echo.
echo [INFO] Anwendung wurde beendet.
pause