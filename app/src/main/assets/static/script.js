const days = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag'
];

function getISOWeek(date) {
  const d = new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ));

  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);

  const yearStart =
    new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  return Math.ceil(
    (((d - yearStart) / 86400000) + 1) / 7
  );
}

function getISOWeekYear(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  return d.getFullYear();
}

function setISOWeek(delta) {
  const d = new Date(
    state.year,
    0,
    4
  );

  const day = d.getDay() || 7;
  d.setDate(
    d.getDate() - day + 1 +
    (state.week - 1 + delta) * 7
  );

  state.week = getISOWeek(d);
  state.year = getISOWeekYear(d);
}

const state = {
  layers: [],
  currentLayer: null,
  week: getISOWeek(new Date()),
  year: getISOWeekYear(new Date()),
  availableWeeks: []
};

const semester = document.querySelector('#semester');
const subjects = document.querySelector('#subjects');
const schedule = document.querySelector('#schedule');
const status = document.querySelector('#status');
const count = document.querySelector('#count');
const layersEl = document.querySelector('#layers');
const prevWeek = document.querySelector('#prevWeek');
const todayWeek = document.querySelector('#todayWeek');
const nextWeek = document.querySelector('#nextWeek');
const weekTitle = document.querySelector('#weekTitle');
const savePlan = document.querySelector('#savePlanBtn');

/* =========================================================
   HILFSFUNKTIONEN
   ========================================================= */

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c])
  );
}

savePlan?.addEventListener(
  'click',
  saveCurrentPlan
);


function minutes(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));

  return m
    ? Number(m[1]) * 60 + Number(m[2])
    : NaN;
}


function cleanText(s) {
  if (s == null) return '';

  if (
    typeof s === 'string' ||
    typeof s === 'number' ||
    typeof s === 'boolean'
  ) {
    return String(s).replace(/\s+/g, ' ').trim();
  }

  if (Array.isArray(s)) {
    return s
      .map(cleanText)
      .filter(Boolean)
      .join(', ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (typeof s === 'object') {
    for (const key of [
      'label',
      'name',
      'value',
      'text',
      'title',
      'activity',
      'veranstaltung',
      'identifier'
    ]) {
      if (s[key] != null) {
        return cleanText(s[key]);
      }
    }

    return '';
  }

  return '';
}


/* =========================================================
   FACH / GRUPPEN ERKENNUNG
   ========================================================= */

function groupInfo(activity) {
  const raw = cleanText(activity);

  const groupPatterns = [
    /(?:^|\s)Gr\.\s*([0-9]+[A-Za-z]?(?:\s*\+\s*[0-9]+[A-Za-z]?)*)(?=\s|$)/i,
    /(?:^|\s)Gruppe\s*([0-9]+[A-Za-z]?(?:\s*\+\s*[0-9]+[A-Za-z]?)*)(?=\s|$)/i
  ];

  let group = null;
  let base = raw;

  for (const re of groupPatterns) {
    const m = base.match(re);

    if (m) {
      group = `Gruppe ${m[1].replace(/\s*\+\s*/g, '+')}`;
      base = cleanText(base.replace(m[0], ' '));
      break;
    }
  }

  const isLecture = /\(V\)/i.test(raw);

  const canonical = cleanText(
    raw
      .replace(
        /(?:\s+Gr\.?\s*[0-9A-Za-z]+(?:\s*\+\s*[0-9A-Za-z]+)*)|(?:\s+Gruppe\s*[0-9A-Za-z]+(?:\s*\+\s*[0-9A-Za-z]+)*)/gi,
        ''
      )
      .replace(
        /\s*\((?:V|Ü|ÜP|P|Pr|Sem)\)\s*/gi,
        ' '
      )
      .replace(/\s{2,}/g, ' ')
  ).trim().toLowerCase();

  const parent = cleanText(
    raw
      .replace(
        /\s+(?:Gr\.?|Gruppe)\s*[0-9A-Za-z]+(?:\s*\+\s*[0-9A-Za-z]+)*/i,
        ''
      )
      .replace(
        /\s*\((?:Ü|ÜP|P|Pr|Sem)\)\s*/gi,
        ' '
      )
      .replace(/\s{2,}/g, ' ')
  );

  return {
    parent: isLecture ? raw : parent,
    group,
    isLecture,
    canonical
  };
}


/* =========================================================
   EVENTS
   ========================================================= */

function eventKey(e) {
  return [
    e.week ?? '',
    e.day,
    e.start,
    e.end,
    e.room,
    e.activity,
    e.period,
    e.lecturer
  ]
    .map(cleanText)
    .join('|');
}


function normalizeEvents(events) {
  const seen = new Set();
  const out = [];

  for (const e of events) {
    const x = {
      ...e,
      start: cleanText(e.start).padStart(5, '0'),
      end: cleanText(e.end).padStart(5, '0'),
      activity: cleanText(e.activity),
      room: cleanText(e.room),
      period: cleanText(e.period),
      lecturer: cleanText(e.lecturer)
    };

    const key = eventKey(x);

    if (!seen.has(key)) {
      seen.add(key);
      out.push(x);
    }
  }

  return out;
}


/* =========================================================
   FÄCHER-BAUM ERSTELLEN
   ========================================================= */

function makeTree(events) {
  const infos = events.map(e => ({
    e,
    info: groupInfo(e)
  }));

  const lectureRoots = new Map();

  for (const { e, info } of infos) {
    if (
      info.isLecture &&
      !lectureRoots.has(info.canonical)
    ) {
      lectureRoots.set(
        info.canonical,
        e.activity
      );
    }
  }

  const groups = new Map();

  for (const { e, info } of infos) {
    const root =
      lectureRoots.get(info.canonical) ||
      info.parent ||
      e.activity;

    if (!groups.has(root)) {
      groups.set(root, {
        name: root,
        groups: new Map()
      });
    }

    if (info.group) {
      groups
        .get(root)
        .groups
        .set(info.group, info.group);
    }
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'de')
  );
}


function rootNameForEvent(events, e) {
  const info = groupInfo(e);

  const lecture = events.find(x => {
    const i = groupInfo(x.activity);

    return (
      i.isLecture &&
      !i.group &&
      i.canonical === info.canonical
    );
  });

  return lecture
    ? cleanText(lecture.activity)
    : info.parent;
}


/* =========================================================
   LAYER
   ========================================================= */

function newLayer(label, events, identifier, weekEvents = events) {
  const normalized = normalizeEvents(events);
  const normalizedWeek = normalizeEvents(weekEvents);

  return {
    label,
    identifier,
    events: normalized,
    weekEvents: normalizedWeek,
    tree: makeTree(normalized),

    /*
     * Welche Termine sind aktiviert?
     */
    selected: new Set(
      normalized.map(eventKey)
    ),

    /*
     * Welche Fächer sind eingeklappt?
     *
     * Dadurch bleibt der Zustand erhalten,
     * wenn renderSubjects() erneut ausgeführt wird.
     */
    collapsed: new Set(),

    fixed: false
  };
}


function allVisible() {
  return state.layers.flatMap(layer =>
    layer.weekEvents
      .filter(e =>
        layer.selected.has(eventKey(e))
      )
      .map(e => ({
        ...e,
        _layer: layer
      }))
  );
}


function refreshWeekEvents() {
  for (const layer of state.layers) {
    layer.weekEvents = layer.events.filter(
      e => Number(e.week) === Number(state.week)
    );
  }
}


/* =========================================================
   LAYER RENDERN
   ========================================================= */

function renderLayers() {
  layersEl.innerHTML =
    state.layers
      .map((layer, i) => `
        <div class="layer-head ${layer.fixed ? 'fixed' : ''}">
          <label>
            <input
              type="checkbox"
              data-layer="${i}"
              ${layer.fixed ? 'checked' : ''}
            >

            <strong>${esc(layer.label)}</strong>
          </label>

          ${
            layer.fixed
              ? '<span class="layer-fixed">festgesetzt</span>'
              : ''
          }
        </div>
      `)
      .join('');

  layersEl
    .querySelectorAll('input[data-layer]')
    .forEach(cb => {
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.layer);

        state.layers[i].fixed = cb.checked;

        renderLayers();
        renderSubjects();
        updateEventVisibility();
      });
    });
}


/* =========================================================
   FÄCHER RENDERN
   ========================================================= */

function renderSubjects() {
  count.textContent =
    `${state.layers.length} Studiengang${
      state.layers.length === 1 ? '' : 'gänge'
    } · zuletzt geladen zuerst`;

  subjects.innerHTML =
    state.layers
      .map((layer, li) => {
        const nodes = layer.tree;

        return `
          <div class="layer-subjects">

            <div class="layer-title">
              ${esc(layer.label)}
            </div>

            ${nodes.map((node, ni) => {

              const nodeEvents =
                layer.events.filter(
                  e =>
                    rootNameForEvent(
                      layer.events,
                      e
                    ) === node.name
                );

              const weekNodeEvents =
                layer.weekEvents.filter(e =>
                  rootNameForEvent(layer.events, e) === node.name
                );

              const checked =
                nodeEvents.length > 0 &&
                nodeEvents.every(e =>
                  layer.selected.has(
                    eventKey(e)
                  )
                );

              const unavailableThisWeek = weekNodeEvents.length === 0;

              const hasGroups =
                node.groups.size > 0;

              /*
               * Zustand des Faches aus layer.collapsed holen.
               */
              const collapsed =
                layer.collapsed.has(node.name);

              /* -------------------------
                 Untergruppen
                 ------------------------- */

              const children =
                hasGroups
                  ? [...node.groups.keys()]
                      .sort((a, b) =>
                        a.localeCompare(b, 'de')
                      )
                      .map((g, gi) => {

                        const ev =
                          nodeEvents.filter(e =>
                            groupInfo(
                              e.activity
                            ).group === g
                          );

                        const weekEv = layer.weekEvents.filter(e => {
                          const info = groupInfo(e.activity);
                          return rootNameForEvent(layer.events, e) === node.name && info.group === g;
                        });
                        const unavailable = weekEv.length === 0;

                        const all =
                          ev.length > 0 &&
                          ev.every(e =>
                            layer.selected.has(
                              eventKey(e)
                            )
                          );

                        const id =
                          `g-${li}-${ni}-${gi}`;

                        return `
                          <div class="tree-child ${unavailable ? 'week-unavailable' : ''}" title="${unavailable ? 'In dieser Woche kein Termin' : ''}">

                            <input
                              type="checkbox"
                              id="${id}"
                              data-type="group"
                              data-layer="${li}"
                              data-parent="${esc(node.name)}"
                              data-group="${esc(g)}"
                              ${all ? 'checked' : ''}
                            >

                            <label for="${id}">
                              ${esc(g)}
                              <span class="child-count">
                                (${ev.length})
                              </span>
                              ${unavailable ? '<span class="week-note">diese Woche nicht</span>' : ''}
                            </label>

                          </div>
                        `;
                      })
                      .join('')
                  : '';

              /* -------------------------
                 Hauptfach
                 ------------------------- */

              return `
                <div
                  class="tree-node ${
                    hasGroups
                      ? 'has-children'
                      : ''
                  } ${
                    collapsed
                      ? 'collapsed'
                      : ''
                  }"
                  data-node="${esc(node.name)}"
                >

                  <div class="tree-row">

                    <button
                      type="button"
                      class="tree-toggle"
                      aria-label="Ein-/Ausklappen"
                      ${
                        hasGroups
                          ? ''
                          : 'disabled'
                      }
                    >
                      ${
                        hasGroups
                          ? (
                              collapsed
                                ? '▸'
                                : '▾'
                            )
                          : '·'
                      }
                    </button>

                    <input
                      type="checkbox"
                      id="p-${li}-${ni}"
                      data-type="parent"
                      data-layer="${li}"
                      data-parent="${esc(node.name)}"
                      ${checked ? 'checked' : ''}
                    >

                    <label for="p-${li}-${ni}">
                      ${esc(node.name)}
                      ${unavailableThisWeek ? '<span class="week-note">diese Woche nicht</span>' : ''}
                    </label>

                  </div>

                  ${children}

                </div>
              `;
            }).join('')}

          </div>
        `;
      })
      .join('');


  /* =======================================================
     HAUPTFACH-CHECKBOXEN
     ======================================================= */

  subjects
    .querySelectorAll(
      'input[data-type="parent"]'
    )
    .forEach(cb => {

      cb.addEventListener(
        'change',
        () => {

          const layer =
            state.layers[
              Number(cb.dataset.layer)
            ];

          const parent =
            cb.dataset.parent;

          layer.events
            .filter(e =>
              rootNameForEvent(
                layer.events,
                e
              ) === parent
            )
            .forEach(e => {

              if (cb.checked) {
                layer.selected.add(
                  eventKey(e)
                );
              } else {
                layer.selected.delete(
                  eventKey(e)
                );
              }

            });

          /*
           * renderSubjects() erzeugt den Baum neu.
           *
           * Der Zustand collapsed bleibt
           * aber in layer.collapsed erhalten.
           */
          renderSubjects();
          updateEventVisibility();
        }
      );

    });


  /* =======================================================
     GRUPPEN-CHECKBOXEN
     ======================================================= */

  subjects
    .querySelectorAll(
      'input[data-type="group"]'
    )
    .forEach(cb => {

      cb.addEventListener(
        'change',
        () => {

          const layer =
            state.layers[
              Number(cb.dataset.layer)
            ];

          const parent =
            cb.dataset.parent;

          const group =
            cb.dataset.group;

          layer.events
            .filter(e => {

              const info =
                groupInfo(e.activity);

              return (
                rootNameForEvent(
                  layer.events,
                  e
                ) === parent &&
                info.group === group
              );
            })
            .forEach(e => {

              if (cb.checked) {
                layer.selected.add(
                  eventKey(e)
                );
              } else {
                layer.selected.delete(
                  eventKey(e)
                );
              }

            });

          renderSubjects();
          updateEventVisibility();
        }
      );

    });


  /* =======================================================
     EIN-/AUSKLAPPEN
     ======================================================= */

  subjects
    .querySelectorAll('.tree-toggle')
    .forEach(btn => {

      btn.addEventListener(
        'click',
        () => {

          const node =
            btn.closest('.tree-node');

          const nodeName =
            node.dataset.node;

          /*
           * Herausfinden, zu welchem Layer
           * der geklickte Knoten gehört.
           */
          const layerElements =
            [...subjects.querySelectorAll(
              '.layer-subjects'
            )];

          const layerIndex =
            layerElements.findIndex(
              layerEl =>
                layerEl.contains(node)
            );

          if (layerIndex < 0) {
            return;
          }

          const layer =
            state.layers[layerIndex];

          /*
           * Zustand umschalten.
           */
          if (
            layer.collapsed.has(nodeName)
          ) {
            layer.collapsed.delete(
              nodeName
            );
          } else {
            layer.collapsed.add(
              nodeName
            );
          }

          /*
           * Nur das aktuelle Element
           * visuell ändern.
           */
          const isCollapsed =
            layer.collapsed.has(nodeName);

          node.classList.toggle(
            'collapsed',
            isCollapsed
          );

          btn.textContent =
            isCollapsed
              ? '▸'
              : '▾';
        }
      );

    });
}


/* =========================================================
   SEMESTER LADEN
   ========================================================= */
async function getSavedPlans() {
  try {
    const r = await fetch('/api/saved');
    const d = await r.json();

    if (!r.ok) {
      throw new Error(
        d.error || 'Gespeicherte Pläne konnten nicht geladen werden.'
      );
    }

    return Array.isArray(d.items)
      ? d.items
      : [];

  } catch (e) {

    console.error(
      'Fehler beim Laden der gespeicherten Pläne:',
      e
    );

    return [];
  }
}

async function loadSemesters() {

  try {

    const [
      semesterResponse,
      savedPlans
    ] = await Promise.all([
      fetch('/api/semesters'),
      getSavedPlans()
    ]);

    const d =
      await semesterResponse.json();

    if (!semesterResponse.ok) {
      throw new Error(
        d.error
      );
    }

    /*
     * -------------------------------------------------------
     * GESPEICHERTE PLÄNE
     * -------------------------------------------------------
     */

    const savedOptions =
      savedPlans
        .map(plan => `
          <option
            value="__saved__:${esc(plan.name)}"
            data-saved-name="${esc(plan.name)}"
          >
            💾 ${esc(plan.name)}
          </option>
        `)
        .join('');


    /*
     * -------------------------------------------------------
     * EVA2 SEMESTER
     * -------------------------------------------------------
     */

    const semesterOptions =
      d.items
        .map(x => `
          <option
            value="${esc(x.identifier)}"
          >
            ${esc(x.label)}
          </option>
        `)
        .join('');


    /*
     * Gespeicherte Pläne IMMER ganz oben.
     */

    semester.innerHTML =
      savedOptions +
      semesterOptions;


    status.textContent =
      `${d.items.length} Auswahlmöglichkeiten`;


    /*
     * Change-Handler nur einmal registrieren.
     */

    if (!semester.dataset.listenerAttached) {

      semester.addEventListener(
        'change',
        handleSemesterChange
      );

      semester.dataset.listenerAttached =
        'true';
    }


    /*
     * Wenn es gespeicherte Pläne gibt,
     * den ersten automatisch auswählen.
     *
     * Falls du stattdessen möchtest, dass
     * immer das erste Eva2-Semester startet,
     * kann man das leicht ändern.
     */

    if (savedPlans.length > 0) {

      semester.selectedIndex = 0;

      await loadSavedPlan(
        savedPlans[0].name
      );

    } else if (d.items.length) {

      semester.selectedIndex =
        savedPlans.length;

      await loadSchedule();
    }


  } catch (e) {

    status.textContent =
      'Fehler';

    semester.innerHTML =
      '<option>Auswahl konnte nicht geladen werden</option>';

    schedule.innerHTML =
      `<div class="empty">
        ${esc(e.message)}
      </div>`;
  }
}


/* =========================================================
   STUNDENPLAN LADEN
   ========================================================= */

async function loadSchedule() {
  const id =
    cleanText(semester.value);

  if (!id) {
    return;
  }

  status.textContent =
    'Lade Stundenplan …';

  schedule.innerHTML =
    '<div class="empty">Lade …</div>';

  try {

    const r =
      await fetch(
        '/api/schedule?identifier_semester=' +
        encodeURIComponent(id) +
        '&week=' +
        encodeURIComponent(state.week)
      );

    const d =
      await r.json();

    if (!r.ok) {
      throw new Error(
        cleanText(d.error) ||
        'Fehler beim Laden'
      );
    }

    if (Array.isArray(d.available_weeks)) {
      state.availableWeeks = d.available_weeks
        .map(Number)
        .filter(w => Number.isInteger(w) && w >= 1 && w <= 53)
        .sort((a, b) => a - b);
    }

    updateWeekNavigation();

    const label =
      cleanText(
        semester.options[
          semester.selectedIndex
        ]?.text
      ) || id;

    const layer =
      newLayer(
        label,
        Array.isArray(d.all_events)
          ? d.all_events
          : (Array.isArray(d.events) ? d.events : []),
        id,
        Array.isArray(d.events) ? d.events : []
      );

    if (
      Array.isArray(d.selected_courses) &&
      d.selected_courses.length > 0
    ) {
      const saved =
        new Set(d.selected_courses);

      layer.selected =
        new Set(
          layer.events
            .filter(event =>
              saved.has(
                eventKey(event)
              )
            )
            .map(eventKey)
        );
    }

    /*
     * Derselbe Studiengang darf nur einmal
     * vorhanden sein.
     */
    state.layers =
      state.layers.filter(
        x =>
          cleanText(x.identifier) !== id
      );

    /*
     * Nicht festgesetzte aktuelle Ebene
     * ersetzen.
     */
    const transientIndex =
      state.layers.findIndex(
        x => !x.fixed
      );

    if (transientIndex >= 0) {
      state.layers.splice(
        transientIndex,
        1
      );
    }

    state.layers.unshift(layer);

    state.currentLayer = 0;
    refreshWeekEvents();

    renderLayers();
    renderSubjects();
    render();

    updateWeekTitle();

    status.textContent =
      `${allVisible().length} Termine · ` +
      `${state.layers.length} Studiengänge`;

  } catch (e) {

    schedule.innerHTML =
      `<div class="empty">
        ${esc(cleanText(e.message))}
      </div>`;

    status.textContent =
      'Fehler';
  }
}

async function handleSemesterChange() {

  const value =
    cleanText(semester.value);

  if (!value) {
    return;
  }

  /*
   * Gespeicherter Stundenplan
   */
  if (
    value.startsWith('__saved__:')
  ) {

    const name =
      value.substring(
        '__saved__:'.length
      );

    await loadSavedPlan(name);

    return;
  }

  /*
   * Normaler Eva2-Eintrag
   */
  await loadSchedule();
}



/* =========================================================
   ÜBERLAPPUNGEN
   ========================================================= */

function overlapMap(events) {
  const map = new Map();
  const byDay = {};

  for (const e of events) {
    (byDay[e.day] ??= []).push(e);
  }

  for (const day of Object.keys(byDay)) {

    const items =
      byDay[day].filter(
        e =>
          Number.isFinite(
            minutes(e.start)
          ) &&
          Number.isFinite(
            minutes(e.end)
          )
      );

    for (const e of items) {

      const matches =
        items.filter(
          x =>
            minutes(x.start) <
              minutes(e.end) &&
            minutes(x.end) >
              minutes(e.start)
        );

      map.set(
        e._uid,
        matches.length
      );
    }
  }

  return map;
}


/* =========================================================
   STUNDENPLAN RENDERN
   ========================================================= */

function render() {

  const allWeekEvents =
    state.layers.flatMap(layer =>
      layer.weekEvents.map(e => ({
        ...e,
        _layer: layer,
        _uid: `${layer.identifier}|${eventKey(e)}`
      }))
    );

  if (!allWeekEvents.length) {
    schedule.innerHTML =
      '<div class="empty">Für die aktuelle Woche gibt es keine Termine.</div>';
    return;
  }

  const starts =
    allWeekEvents
      .map(e => minutes(e.start))
      .filter(Number.isFinite);

  const ends =
    allWeekEvents
      .map(e => minutes(e.end))
      .filter(Number.isFinite);

  let min =
    Math.floor(Math.min(8 * 60, ...starts) / 15) * 15;

  let max =
    Math.ceil(Math.max(18 * 60, ...ends) / 15) * 15;

  const rows = (max - min) / 15;

  let html =
    '<div class="schedule-wrap">' +
      '<div class="week">' +
        '<div class="head"></div>' +
        days.map(d => `<div class="head">${d}</div>`).join('');

  html += `<div class="timeline" style="--rows:${rows}">`;

  for (let t = min; t <= max; t += 30) {
    const top = ((t - min) / 15) * 24;
    html += `<div class="time-label" style="top:${top}px">${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</div>`;
  }

  html += '</div>';

  for (const day of days) {
    html += `<div class="day" style="--rows:${rows}">`;

    const dayEvents =
      allWeekEvents
        .filter(x => x.day === day)
        .sort((a, b) => {
          const startDiff =
            minutes(a.start) - minutes(b.start);

          if (startDiff !== 0) {
            return startDiff;
          }

          /*
          * Bei gleicher Startzeit:
          * längerer Termin liegt weiter oben.
          */
          return (
            minutes(b.end) -
            minutes(a.end)
          );
        });

    dayEvents.forEach((e, index) => {
      const st = minutes(e.start);
      const en = Math.max(
        minutes(e.end),
        st + 15
      );

      const top =
        ((st - min) / 15) * 24 + 1;

      const height =
        Math.max(
          ((en - st) / 15) * 24 - 3,
          22
        );

      const info =
        groupInfo(e.activity);


      html += `
        <div
          class="event"
          data-uid="${esc(e._uid)}"
          data-layer-identifier="${esc(e._layer.identifier)}"
          data-event-key="${esc(eventKey(e))}"
          style="
            top:${top}px;
            height:${height}px;
            z-index:${index};
          "
        >
          <strong>${esc(info.parent)}</strong>

          ${
            info.group
              ? `<div class="meta">${esc(info.group)}</div>`
              : ''
          }

          <div class="meta">
            ${esc(e.start)}–${esc(e.end)}
            · ${esc(e.room)}
          </div>

          <div class="meta">
            ${esc(e.lecturer)}
          </div>
        </div>`;
    });

    html += '</div>';
  }



  html += '</div></div>';
  schedule.innerHTML = html;

  updateNowLine(min, max);
  updateEventVisibility();
}


/*
 * Die Terminblöcke werden beim Umschalten der Fächer nicht neu aufgebaut.
 * Stattdessen wird nur ihre Sichtbarkeit geändert. Der Überlappungszähler
 * wird dabei ausschließlich für die aktuell sichtbaren Termine berechnet.
 */
function updateEventVisibility() {
  const visible = allVisible().map(e => ({
    ...e,
    _uid: `${e._layer.identifier}|${eventKey(e)}`
  }));

  const visibleIds = new Set(visible.map(e => e._uid));
  const om = overlapMap(visible);

  schedule.querySelectorAll('.event[data-uid]').forEach(el => {
    const uid = el.dataset.uid;
    const isVisible = visibleIds.has(uid);

    el.style.display = isVisible ? '' : 'none';

    let badge = el.querySelector('.overlap-badge');
    const overlap = om.get(uid) || 0;

    if (overlap > 1) {
      if (!badge) {
        badge = document.createElement('button');
        badge.type = 'button';
        badge.className = 'overlap-badge';
        el.appendChild(badge);
      }

      badge.dataset.uid = uid;
      badge.title = `${overlap} überlagernde Termine`;
      badge.textContent = overlap;
    } else if (badge) {
      badge.remove();
    }
  });

  attachOverlapButtons(visible);

  status.textContent =
    `${visible.length} Termine · ${state.layers.length} Studiengänge`;
}


/* =========================================================
   ÜBERLAPPUNGS-POPOVER
   ========================================================= */

function attachOverlapButtons(
    visible
) {

    function showEvent(eventElement, matches, index) {
        const event = matches[index];

        if (!event) return;

        const info = groupInfo(event.activity);

        /*
         * Anzahl der noch folgenden Termine.
         *
         * Beispiel bei 3 Terminen:
         *
         * Termin 1 → 3
         * Termin 2 → 2
         * Termin 3 → 1
         */
        const remaining =
            matches.length - index;

        eventElement.innerHTML = `
            <button
                type="button"
                class="overlap-badge"
                title="Nächsten überlagernden Termin anzeigen"
            >
                ${remaining}
            </button>

            <strong>
                ${esc(info.parent)}
            </strong>

            ${
                info.group
                    ? `<div class="meta">${esc(info.group)}</div>`
                    : ''
            }

            <div class="meta">
                ${esc(event.start)}–${esc(event.end)}
                · ${esc(event.room)}
            </div>

            <div class="meta">
                ${esc(event.lecturer)}
            </div>
        `;

        const button =
            eventElement.querySelector('.overlap-badge');

        if (!button) return;

        button.addEventListener('click', () => {

            /*
             * Zum nächsten überlagerten Termin.
             */
            const nextIndex =
                index + 1;

            /*
             * Wenn wir beim letzten angekommen sind,
             * wieder beim ersten beginnen.
             */
            const wrappedIndex =
                nextIndex >= matches.length
                    ? 0
                    : nextIndex;

            showEvent(
                eventElement,
                matches,
                wrappedIndex
            );
        });
    }


    schedule
        .querySelectorAll('.overlap-badge')
        .forEach(button => {

            const eventElement =
                button.closest('.event');

            if (!eventElement) return;

            const uid =
                button.dataset.uid;

            const target =
                visible.find(
                    e => e._uid === uid
                );

            if (!target) return;

            const matches =
                visible.filter(e =>
                    e.day === target.day &&
                    minutes(e.start) < minutes(target.end) &&
                    minutes(e.end) > minutes(target.start)
                );

            if (matches.length <= 1) return;

            /*
             * Aktuelle Position innerhalb der
             * überlagerten Termine.
             */
            const currentIndex =
                matches.findIndex(
                    e => e._uid === target._uid
                );

            showEvent(
                eventElement,
                matches,
                currentIndex
            );
        });
}



function updateNowLine(min, max) {
  const wrap =
    schedule.querySelector('.schedule-wrap');

  if (!wrap) {
    return;
  }

  /*
   * Alte Linie entfernen.
   */
  wrap
    .querySelectorAll('.now-line')
    .forEach(line => line.remove());

  /*
   * Aktuelle Zeit.
   */
  const now = new Date();

  const day = now.getDay();

  /*
   * Aktuelle Uhrzeit in Minuten.
   */
  const current =
    now.getHours() * 60 +
    now.getMinutes() +
    now.getSeconds() / 60;

  /*
   * Wenn die Uhrzeit außerhalb des dargestellten
   * Stundenplanbereichs liegt, keine Linie anzeigen.
   */
  if (current < min || current > max) {
    return;
  }

  /*
   * Vertikale Position innerhalb des Stundenrasters.
   *
   * 15 Minuten = 24 Pixel
   */
  const top =
    ((current - min) / 15) * 24;


  /* =======================================================
     AKTUELLEN TAG HERVORHEBEN
     ======================================================= */

  const dayElements =
    wrap.querySelectorAll('.day');

  /*
   * Alle bisherigen Hervorhebungen entfernen.
   */
  dayElements.forEach(dayElement => {
    dayElement.classList.remove(
      'current-day'
    );
  });

  /*
   * Montag = Index 0
   * Dienstag = Index 1
   * ...
   * Samstag = Index 5
   */
  const currentDayElement =
    dayElements[day - 1];

  if (currentDayElement) {
    currentDayElement.classList.add(
      'current-day'
    );
  }


  /* =======================================================
     ROTE LINIE
     ======================================================= */

  /*
   * Die .week ist dein kompletter Stundenplan.
   *
   * Wir setzen die Linie direkt in .week,
   * damit sie über alle sechs Tage läuft.
   */
  const week =
    wrap.querySelector('.week');

  if (!week) {
    return;
  }

  /*
   * .week braucht eine relative Positionierung,
   * damit top korrekt funktioniert.
   */
  week.style.position = 'relative';


  const line =
    document.createElement('div');

  line.className =
    'now-line';

  const headerHeight = 46;

  line.style.top =
    `${headerHeight + top}px`;


  const currentTime =
    `${String(now.getHours()).padStart(2, '0')}:` +
    `${String(now.getMinutes()).padStart(2, '0')}`;

  /*
   * Punkt und "Jetzt"-Label.
   */
  line.innerHTML = `
    <span class="now-label">
      Now ${currentTime}
    </span>
  `;

  /*
   * Die Linie wird direkt in .week eingefügt
   * und liegt damit über dem gesamten Stundenplan.
   */
  week.appendChild(line);
}



/* =========================================================
   AKTUELLE ZEIT REGELMÄSSIG AKTUALISIEREN
   ========================================================= */

setInterval(() => {

  const visible =
    allVisible();

  if (!visible.length) {
    return;
  }

  const starts =
    visible
      .map(e =>
        minutes(e.start)
      )
      .filter(
        Number.isFinite
      );

  const ends =
    visible
      .map(e =>
        minutes(e.end)
      )
      .filter(
        Number.isFinite
      );

  const min =
    Math.floor(
      Math.min(
        8 * 60,
        ...starts
      ) / 15
    ) * 15;

  const max =
    Math.ceil(
      Math.max(
        18 * 60,
        ...ends
      ) / 15
    ) * 15;

  updateNowLine(
    min,
    max
  );

}, 30000);


/* =========================================================
   "ALLE FÄCHER"
   ========================================================= */

document
  .querySelector('#all')
  .addEventListener(
    'click',
    () => {

      state.layers.forEach(
        layer => {

          layer.selected =
            new Set(
              layer.events.map(
                eventKey
              )
            );

        }
      );

      renderSubjects();
      render();
    }
  );


/* =========================================================
   WOCHENSTEUERUNG
   ========================================================= */

function updateWeekTitle() {
  if (weekTitle) {
    weekTitle.textContent = `KW ${state.week} · ${state.year}`;
  }
}

function updateWeekNavigation() {
  const weeks = state.availableWeeks;
  const hasBounds = weeks.length > 0;

  const firstWeek = hasBounds ? weeks[0] : null;
  const lastWeek = hasBounds ? weeks[weeks.length - 1] : null;

  if (prevWeek) {
    prevWeek.disabled = hasBounds && state.week <= firstWeek;
  }

  if (nextWeek) {
    nextWeek.disabled = hasBounds && state.week >= lastWeek;
  }
}

function reloadCurrentWeek() {
  refreshWeekEvents();
  updateWeekTitle();
  updateWeekNavigation();
  renderSubjects();
  render();

  status.textContent =
    `${allVisible().length} Termine · ` +
    `${state.layers.length} Studiengänge`;
}

prevWeek?.addEventListener('click', () => {
  if (prevWeek.disabled) return;

  const weeks = state.availableWeeks;
  const i = weeks.indexOf(state.week);
  if (i > 0) {
    state.week = weeks[i - 1];
    reloadCurrentWeek();
  }
});

todayWeek?.addEventListener('click', () => {
  const now = new Date();
  state.week = getISOWeek(now);
  state.year = getISOWeekYear(now);
  reloadCurrentWeek();
});

nextWeek?.addEventListener('click', () => {
  if (nextWeek.disabled) return;

  const weeks = state.availableWeeks;
  const i = weeks.indexOf(state.week);
  if (i >= 0 && i < weeks.length - 1) {
    state.week = weeks[i + 1];
    reloadCurrentWeek();
  }
});

updateWeekTitle();
updateWeekNavigation();


/* =========================================================
   Studenplan laden / speichern
   ========================================================= */

async function saveCurrentPlan() {

  const defaultName =
    'Mein Stundenplan';

  const name =
    window.prompt(
      'Name für den Stundenplan:',
      defaultName
    );

  if (!name || !name.trim()) {
    return;
  }

  const semesters =
    state.layers.map(layer => ({

      identifier:
        cleanText(layer.identifier),

      label:
        cleanText(layer.label),

      fixed:
        Boolean(layer.fixed),

      selected_courses:
        [...layer.selected]

    }));


  if (!semesters.length) {

    status.textContent =
      'Kein Studiengang geladen.';

    return;
  }


  /*
   * Aktuell im Dropdown ausgewähltes
   * Semester merken.
   *
   * Bei einem gespeicherten Plan ist
   * der eigentliche aktuelle Semesterwert
   * ebenfalls relevant.
   */

  const currentSemester =
    semester.value.startsWith(
      '__saved__:'
    )
      ? ''
      : cleanText(
          semester.value
        );


  try {

    status.textContent =
      'Speichere …';


    const r =
      await fetch(
        '/api/saved',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify({

            name:
              name.trim(),

            current_semester:
              currentSemester,

            semesters

          })
        }
      );


    const d =
      await r.json();


    if (!r.ok) {

      throw new Error(
        d.error ||
        'Speichern fehlgeschlagen.'
      );
    }


    status.textContent =
      `Gespeichert: ${d.name}`;


    /*
     * Dropdown neu laden,
     * damit die neue Datei sofort
     * ganz oben erscheint.
     */

    await refreshSavedPlans(
      d.name
    );


  } catch (e) {

    status.textContent =
      `Fehler: ${e.message}`;
  }
}

async function loadSavedPlan(name) {

  status.textContent =
    `Lade "${name}" …`;

  schedule.innerHTML =
    '<div class="empty">Lade gespeicherten Stundenplan …</div>';


  try {

    const r =
      await fetch(
        '/api/saved/' +
        encodeURIComponent(name)
      );


    const saved =
      await r.json();


    if (!r.ok) {

      throw new Error(
        saved.error ||
        'Gespeicherter Plan konnte nicht geladen werden.'
      );
    }


    /*
     * Alten Zustand komplett entfernen.
     */

    state.layers = [];

    state.currentLayer = null;


    /*
     * Jedes gespeicherte Semester
     * wieder laden.
     */

    for (
      const savedSemester
      of saved.semesters || []
    ) {

      const id =
        cleanText(
          savedSemester.identifier
        );

      if (!id) {
        continue;
      }


      const r =
        await fetch(
          '/api/schedule?identifier_semester=' +
          encodeURIComponent(id) +
          '&week=' +
          encodeURIComponent(state.week)
        );


      const d =
        await r.json();


      if (!r.ok) {

        console.error(
          `Semester ${id} konnte nicht geladen werden`,
          d
        );

        continue;
      }


      const events =
        Array.isArray(d.all_events)
          ? d.all_events
          : (
              Array.isArray(d.events)
                ? d.events
                : []
            );


      const label =
        cleanText(
          savedSemester.label
        ) || id;


      const layer =
        newLayer(
          label,
          events,
          id,
          events
        );


      /*
       * Gespeicherte Checkbox-Auswahl
       * wiederherstellen.
       */

      const selected =
        new Set(
          Array.isArray(
            savedSemester.selected_courses
          )
            ? savedSemester.selected_courses
            : []
        );


      layer.selected =
        new Set(
          layer.events
            .map(eventKey)
            .filter(key =>
              selected.has(key)
            )
        );


      layer.fixed =
        Boolean(
          savedSemester.fixed
        );


      state.layers.push(
        layer
      );


      /*
       * Wocheninformationen übernehmen.
       */

      if (
        Array.isArray(
          d.available_weeks
        )
      ) {

        state.availableWeeks =
          d.available_weeks
            .map(Number)
            .filter(
              w =>
                Number.isInteger(w) &&
                w >= 1 &&
                w <= 53
            )
            .sort(
              (a, b) => a - b
            );
      }
    }


    /*
     * Gespeichertes aktuelles Semester
     * wiederherstellen.
     */

    if (
      saved.current_semester
    ) {

      const normalOption =
        [...semester.options]
          .find(
            option =>
              option.value ===
              saved.current_semester
          );


      if (normalOption) {

        semester.value =
          saved.current_semester;
      }
    }


    refreshWeekEvents();

    updateWeekNavigation();

    renderLayers();

    renderSubjects();

    render();

    updateWeekTitle();


    status.textContent =
      `"${name}" geladen · ` +
      `${state.layers.length} Studiengänge`;


  } catch (e) {

    console.error(e);

    schedule.innerHTML =
      `<div class="empty">
        ${esc(e.message)}
      </div>`;

    status.textContent =
      'Fehler';
  }
}

async function refreshSavedPlans(
  selectName = null
) {

  const plans =
    await getSavedPlans();


  /*
   * Aktuelle normalen Eva2-Optionen
   * behalten.
   */

  const normalOptions =
    [...semester.options]
      .filter(
        option =>
          !option.value.startsWith(
            '__saved__:'
          )
      )
      .map(option => ({
        value:
          option.value,

        label:
          option.textContent
      }));


  const savedOptions =
    plans
      .map(plan => `
        <option
          value="__saved__:${esc(plan.name)}"
        >
          💾 ${esc(plan.name)}
        </option>
      `)
      .join('');


  const normalHtml =
    normalOptions
      .map(option => `
        <option
          value="${esc(option.value)}"
        >
          ${esc(option.label)}
        </option>
      `)
      .join('');


  semester.innerHTML =
    savedOptions +
    normalHtml;


  /*
   * Neue Datei direkt auswählen.
   */

  if (selectName) {

    semester.value =
      `__saved__:${selectName}`;
  }
}


/* =========================================================
   START
   ========================================================= */

loadSemesters();
