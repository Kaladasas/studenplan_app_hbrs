#!/bin/bash

echo "========================================"
echo " Python Anwendung wird gestartet"
echo "========================================"
echo

Prüfen, ob .venv bereits existiert

if [ ! -f ".venv/bin/python" ]; then
echo "[INFO] .venv wurde nicht gefunden."
echo "[INFO] Erstelle virtuelle Umgebung..."

python3 -m venv .venv

if [ $? -ne 0 ]; then
    echo "[FEHLER] Die virtuelle Umgebung konnte nicht erstellt werden."
    exit 1
fi


else
echo "[INFO] .venv ist bereits vorhanden."
fi

echo
echo "[INFO] Installiere/aktualisiere Abhängigkeiten..."

.venv/bin/python -m pip install -r requirements.txt

if [ $? -ne 0 ]; then
echo
echo "[FEHLER] Installation der Abhängigkeiten fehlgeschlagen."
exit 1
fi

echo
echo "[INFO] Starte app.py..."
echo

.venv/bin/python app.py

echo
echo "[INFO] Anwendung wurde beendet."