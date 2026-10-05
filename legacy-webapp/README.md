# H-BRS Stundenplan WebApp

Die WebApp ruft die H-BRS-eva-Stundenplanseite serverseitig ab.

## Start

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
# chmod +x start.sh
pip install -r requirements.txt
python app.py
```

Dann `http://localhost:5000` öffnen.

## Funktionsweise

1. `/api/semesters` lädt die Seite `https://eva2.inf.h-brs.de/stundenplan/` und liest die Auswahl **Studiengang / Semester** aus.
2. Der ausgewählte `option value` wird als `identifier_semester` gespeichert.
3. `/api/schedule` baut daraus die `anzeigen/`-URL und setzt **immer** den aktuell ausgewählten `identifier_semester`.
4. Die Termine werden aus der Tabelle gelesen und als Montag–Samstag dargestellt.
5. Links können einzelne Fächer per Checkbox ausgeblendet werden.

Der `term`-Wert und die Wochenliste sind im Backend zentral definiert und können bei Bedarf geändert werden.
