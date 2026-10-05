# H-BRS Stundenplan – Android

Android-Port der ursprünglichen Flask-WebApp.

## Was wurde geändert?

- Die bestehende HTML/CSS/JavaScript-Oberfläche bleibt erhalten.
- Flask wurde aus der Android-Laufzeit entfernt.
- Ein kleiner lokaler HTTP-Server in Java stellt `/api/semesters`, `/api/schedule` und `/api/saved` bereit.
- Die Eva2-Abfrage läuft direkt vom Android-Gerät zu `https://eva2.inf.h-brs.de`.
- Gespeicherte Stundenpläne und der technische Cache liegen im privaten App-Speicher.
- Die APK benötigt nur die Internet-Berechtigung.

## APK bauen

### Lokal

Voraussetzungen: JDK 17, Android SDK und Gradle 8.7.

```bash
gradle :app:assembleDebug
```

APK:

`app/build/outputs/apk/debug/app-debug.apk`

### GitHub Actions

Nach dem Hochladen auf GitHub kann der Workflow **Build Android APK** über Actions → Run workflow gestartet werden. Die APK liegt anschließend als Artifact `hbrs-stundenplan-debug-apk` vor.

## Hinweise

Die App verwendet die öffentlich erreichbare H-BRS-Eva2-Seite. Falls H-BRS die HTML-Struktur oder den `term`-Wert ändert, muss der Parser bzw. die Konfiguration in `LocalApiServer.java` angepasst werden.
