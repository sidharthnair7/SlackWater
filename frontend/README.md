# SlackWater frontend

Plain HTML, CSS and JavaScript. No build step, no framework. Maven copies this folder into the app's
`static/` resources (see `pom.xml`), so Spring serves it at `http://localhost:8080/`.

| File | What it does |
|---|---|
| `index.html` | The page: Measure, Readings and Method views |
| `css/app.css` | All the styles (light theme only) |
| `js/app.js` | Loads live readings from `GET /api/readings`, draws the readout and gates, uploads your clip with `POST /api/readings`, handles drawing the water box |
| `js/scene.js` | The viewport: a real clip with the engine's tracking overlay, an evidence frame, or a synthetic test strip |
| `js/real-readings.js` | A saved snapshot of the engine's readings, used only when the server isn't reachable (page opened as a file) |
| `js/samples.js` | The synthetic test clips' readings (the engine's real output on its test clips) |
| `img/evidence/` | Evidence pictures for the snapshot |

Opened straight from disk (`frontend/index.html` in Chrome), the page works offline: it shows the snapshot and
lets you draw a water box on your own clip and read its four numbers, but it can't measure.
