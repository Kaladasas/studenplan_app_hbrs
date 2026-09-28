from flask import Flask, jsonify, request, send_from_directory
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import re

app = Flask(__name__, static_folder='static')

BASE = 'https://eva2.inf.h-brs.de/stundenplan/'
SCHEDULE = 'https://eva2.inf.h-brs.de/stundenplan/anzeigen/'
TERM = 'c32ef58d2e1df421b3b48ef959d32758'

# Alle Wochen an Eva2 übergeben
WEEKS = ';'.join(str(w) for w in range(1, 54))

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Stundenplan-WebApp/1.0'
})

# Cache pro Studiengang/Semester
SCHEDULE_CACHE = {}


def get_soup(url, params=None):
    r = SESSION.get(
        url,
        params=params,
        timeout=30
    )
    r.raise_for_status()
    return BeautifulSoup(r.text, 'html.parser')


def find_semester_select(soup):
    selects = soup.find_all('select')

    for sel in selects:
        name = (sel.get('name') or '').lower()
        sid = (sel.get('id') or '').lower()
        txt = sel.get_text(' ', strip=True).lower()

        if (
            'semester' in name
            or 'semester' in sid
            or 'study' in txt
            or 'studiengang' in txt
        ):
            return sel

    for sel in selects:
        if any(
            'bcsp' in o.get_text(' ', strip=True).lower()
            for o in sel.find_all('option')
        ):
            return sel

    return None


@app.get('/')
def index():
    return send_from_directory(
        app.static_folder,
        'index.html'
    )


@app.get('/api/semesters')
def semesters():
    soup = get_soup(BASE)

    sel = find_semester_select(soup)

    if not sel:
        return jsonify({
            'error': (
                'Studiengang/Semester-Auswahl '
                'wurde auf eva2 nicht gefunden.'
            )
        }), 502

    result = []

    for opt in sel.find_all('option'):
        value = opt.get('value')
        label = opt.get_text(' ', strip=True)

        if not value or not label:
            continue

        if value in ('0', '-1'):
            continue

        if any(
            x in label.lower()
            for x in [
                'bcsp',
                'bi ',
                'bwi',
                'mas',
                'mcsp',
                'mgt',
                'mi ',
                'mksn',
                'mvg'
            ]
        ):
            result.append({
                'label': label,
                'identifier': value
            })

    # Fallback
    if not result:
        result = [
            {
                'label': o.get_text(' ', strip=True),
                'identifier': o.get('value')
            }
            for o in sel.find_all('option')
            if (
                o.get('value')
                and o.get_text(' ', strip=True)
            )
        ]

    return jsonify({
        'items': result,
        'select_name': sel.get('name'),
        'select_id': sel.get('id')
    })


def clean_activity(value):
    return re.sub(
        r'\s+',
        ' ',
        value or ''
    ).strip()


def normalize_time(value):
    value = clean_activity(value)
    value = value.replace('.', ':')

    m = re.fullmatch(
        r'(\d{1,2}):(\d{2})',
        value
    )

    if not m:
        return None

    h = int(m.group(1))
    minute = int(m.group(2))

    if h > 23 or minute > 59:
        return None

    return f'{h:02d}:{minute:02d}'


def parse_period(period):
    """
    Erkennt Zeiträume wie:

        28.09.2026-14.12.2026 (KW 40-04)

        01.10.2026-10.12.2026 (gKW 40-04)

        08.10.2026-17.12.2026 (uKW 41-03)

    Rückgabe:

        start_date
        end_date
        week_mode

    week_mode:
        all  -> jede Woche
        even -> gerade Kalenderwochen
        odd  -> ungerade Kalenderwochen
    """

    period = clean_activity(period)

    if not period:
        return None, None, None

    # Datumsbereich suchen
    m = re.search(
        r'(\d{1,2}\.\d{1,2}\.\d{4})'
        r'\s*-\s*'
        r'(\d{1,2}\.\d{1,2}\.\d{4})',
        period
    )

    if not m:
        return None, None, None

    try:
        start_date = datetime.strptime(
            m.group(1),
            '%d.%m.%Y'
        ).date()

        end_date = datetime.strptime(
            m.group(2),
            '%d.%m.%Y'
        ).date()

    except ValueError:
        return None, None, None

    # Gerade Kalenderwochen
    if re.search(r'\bgKW\b', period, re.IGNORECASE):
        week_mode = 'even'

    # Ungerade Kalenderwochen
    elif re.search(r'\buKW\b', period, re.IGNORECASE):
        week_mode = 'odd'

    # Jede Kalenderwoche
    else:
        week_mode = 'all'

    return start_date, end_date, week_mode


def expand_event_weeks(event):
    """
    Erzeugt aus einer Veranstaltung mit einem Zeitraum
    einen Datensatz pro tatsächlicher Kalenderwoche.

    Beispiel:

        28.09.2026-14.12.2026 (KW 40-04)

    wird zu:

        KW 40
        KW 41
        KW 42
        ...
        KW 52
        KW 01
        ...
        KW 04
    """

    start_date, end_date, week_mode = parse_period(
        event.get('period', '')
    )

    # Kein gültiger Zeitraum erkannt:
    # Event unverändert zurückgeben.
    if not start_date or not end_date:
        return [event]

    day_numbers = {
        'Montag': 0,
        'Dienstag': 1,
        'Mittwoch': 2,
        'Donnerstag': 3,
        'Freitag': 4,
        'Samstag': 5,
        'Sonntag': 6
    }

    target_weekday = day_numbers.get(
        event.get('day')
    )

    if target_weekday is None:
        return [event]

    result = []

    current = start_date

    while current <= end_date:

        # Nur den richtigen Wochentag berücksichtigen
        if current.weekday() == target_weekday:

            iso = current.isocalendar()

            week = iso.week

            # Gerade Kalenderwochen
            if week_mode == 'even' and week % 2 != 0:
                current += timedelta(days=1)
                continue

            # Ungerade Kalenderwochen
            if week_mode == 'odd' and week % 2 != 1:
                current += timedelta(days=1)
                continue

            occurrence = dict(event)

            occurrence['week'] = week
            occurrence['date'] = current.isoformat()

            result.append(occurrence)

        current += timedelta(days=1)

    return result


def parse_schedule(soup):
    """
    Parst die Eva2-Tabelle.

    Wichtig:
    Eva2 liefert bei wiederkehrenden Veranstaltungen nicht
    unbedingt eine Zeile pro Kalenderwoche.

    Stattdessen beispielsweise:

        28.09.2026-14.12.2026 (KW 40-04)

    Deshalb werden die Events nach dem Parsen mit
    expand_event_weeks() auf die einzelnen Wochen erweitert.
    """

    tables = []

    for table in soup.find_all('table'):

        headers = [
            clean_activity(
                x.get_text(' ', strip=True)
            ).lower()
            for x in table.find_all('th')
        ]

        text = clean_activity(
            table.get_text(' ', strip=True)
        ).lower()

        if (
            any(
                'activity' in h
                or 'from' in h
                or 'until' in h
                for h in headers
            )
            or (
                'activity' in text
                and 'from' in text
                and 'until' in text
            )
        ):
            tables.append(table)

    # Fallback
    if not tables:
        tables = soup.find_all('table')

    if not tables:
        return []

    day_map = {
        'mo': 'Montag',
        'monday': 'Montag',
        'montag': 'Montag',

        'tu': 'Dienstag',
        'tue': 'Dienstag',
        'tues': 'Dienstag',
        'di': 'Dienstag',
        'dienstag': 'Dienstag',

        'we': 'Mittwoch',
        'wed': 'Mittwoch',
        'mi': 'Mittwoch',
        'mittwoch': 'Mittwoch',

        'th': 'Donnerstag',
        'thu': 'Donnerstag',
        'do': 'Donnerstag',
        'donnerstag': 'Donnerstag',

        'fr': 'Freitag',
        'fri': 'Freitag',
        'friday': 'Freitag',
        'freitag': 'Freitag',

        'sa': 'Samstag',
        'sat': 'Samstag',
        'samstag': 'Samstag',

        'su': 'Sonntag',
        'sun': 'Sonntag',
        'so': 'Sonntag',
        'sonntag': 'Sonntag'
    }

    events = []

    for table in tables:

        current_day = None

        for tr in table.find_all('tr'):

            cells = [
                clean_activity(
                    c.get_text(' ', strip=True)
                )
                for c in tr.find_all(['td', 'th'])
            ]

            if not cells:
                continue

            # Prüfen, ob die erste Zelle ein Wochentag ist
            first = cells[0].lower().strip()

            first_day = None

            for key, label in day_map.items():

                if (
                    first == key
                    or first.startswith(key + ',')
                    or first.startswith(key + ' ')
                ):
                    first_day = label
                    break

            if first_day:

                current_day = first_day

                cells = cells[1:]

                if not cells:
                    continue

            # Mindestens Start, Ende, Raum, Aktivität
            if current_day and len(cells) >= 4:

                start = normalize_time(
                    cells[0]
                )

                end = normalize_time(
                    cells[1]
                )

                if not start or not end:
                    continue

                event = {
                    'day': current_day,
                    'start': start,
                    'end': end,
                    'room': (
                        cells[2]
                        if len(cells) > 2
                        else ''
                    ),
                    'activity': (
                        cells[3]
                        if len(cells) > 3
                        else ''
                    ),
                    'period': (
                        cells[4]
                        if len(cells) > 4
                        else ''
                    ),
                    'lecturer': (
                        cells[5]
                        if len(cells) > 5
                        else ''
                    )
                }

                events.append(event)

    # ---------------------------------------------------------
    # WICHTIG:
    # Jetzt werden die Serien auf einzelne Kalenderwochen
    # erweitert.
    # ---------------------------------------------------------

    expanded = []

    for event in events:

        expanded_events = expand_event_weeks(
            event
        )

        expanded.extend(
            expanded_events
        )

    # ---------------------------------------------------------
    # Duplikate entfernen
    # ---------------------------------------------------------

    unique = []

    seen = set()

    for event in expanded:

        key = (
            event.get('week'),
            event.get('date'),
            event.get('day'),
            event.get('start'),
            event.get('end'),
            event.get('room'),
            event.get('activity'),
            event.get('period'),
            event.get('lecturer')
        )

        if key in seen:
            continue

        seen.add(key)
        unique.append(event)

    return unique


def scrape_all_weeks(identifier):
    """
    Eva2 wird pro Studiengang/Semester nur EINMAL abgefragt.

    Der Request fordert alle Wochen an.
    Die tatsächlichen Kalenderwochen werden anschließend
    anhand der Veranstaltungszeiträume erzeugt.
    """

    params = {
        'weeks': WEEKS,
        'days': '1-7',
        'mode': 'table',

        'identifier_semester': identifier,

        'show_semester': '',
        'identifier_dozent': '',
        'identifier_raum': '',

        'term': TERM
    }

    print(
        f'[SCRAPE] Lade Stundenplan für: {identifier}'
    )

    print(
        f'[SCRAPE] weeks={WEEKS}'
    )

    soup = get_soup(
        SCHEDULE,
        params=params
    )

    all_events = parse_schedule(
        soup
    )

    available_weeks = sorted(
        {
            e['week']
            for e in all_events
            if e.get('week') is not None
        }
    )

    print(
        f'[SCRAPE] {len(all_events)} Events gefunden'
    )

    print(
        f'[SCRAPE] Wochen: {available_weeks}'
    )

    return {
        'all_events': all_events,

        'available_weeks': available_weeks,

        'plan_weeks': list(
            range(1, 54)
        )
    }


@app.get('/api/schedule')
def schedule():

    identifier = request.args.get(
        'identifier_semester',
        ''
    ).strip()

    if not identifier:
        return jsonify({
            'error': (
                'identifier_semester fehlt.'
            )
        }), 400

    # ---------------------------------------------------------
    # Cache prüfen
    # ---------------------------------------------------------

    cached = SCHEDULE_CACHE.get(
        identifier
    )

    if cached is None:

        print(
            f'[CACHE] Kein Cache für {identifier}'
        )

        cached = scrape_all_weeks(
            identifier
        )

        SCHEDULE_CACHE[
            identifier
        ] = cached

    else:

        print(
            f'[CACHE] Verwende Cache für {identifier}'
        )

    # ---------------------------------------------------------
    # KEIN week-Filter auf dem Server!
    #
    # Auch:
    #
    # /api/schedule?identifier_semester=XXX&week=40
    #
    # liefert ALLE Wochen.
    # ---------------------------------------------------------

    return jsonify({

        'events': cached['all_events'],

        'all_events': cached['all_events'],

        'identifier_semester': identifier,

        # Nur zur Information an das Frontend.
        # Wird NICHT zum Filtern benutzt.
        'week': request.args.get('week'),

        'available_weeks': (
            cached['available_weeks']
        ),

        'plan_weeks': (
            cached['plan_weeks']
        ),

        'cached': True
    })


if __name__ == '__main__':

    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True
    )
