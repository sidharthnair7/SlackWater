# SlackWater frontend

React 19 + TypeScript + Vite. Ready for React components and Three.js (add them with `npm install`).

## Run it while you work on it

Two terminals:

1. The engine (Spring, port 8080), from the project root: `.\mvnw spring-boot:run` (or the green Run arrow in IntelliJ)
2. The page (Vite, port 5173), from this folder: `npm install` once, then `npm run dev`

Open http://localhost:5173. Vite forwards `/api` and `/clips` to the engine, and the page reloads as you edit.
To point at an engine somewhere else: set `SLACKWATER_ENGINE` (for example `http://localhost:8097`) before `npm run dev`.

## How it ships

`.\mvnw package` (and the Dockerfile) builds this folder with its own copy of Node (`frontend/node/`) and packages
`dist/` into the app, so Spring serves the page at http://localhost:8080. Skip that step with
`-Dskip.npm -Dskip.installnodenpm`.

## Files

| Path | What it does |
|---|---|
| `src/App.tsx` | All the page state: live readings (with retry while the engine is still measuring at startup), picking a clip, your own clip, uploading |
| `src/api.ts` | `GET /api/readings` and `POST /api/readings` |
| `src/types.ts` | The API's reading, exactly as the server sends it |
| `src/components/Viewport.tsx` | The canvas, the video and the HUD; drawing the water box |
| `src/scene/Scene.ts` | The canvas drawing: real clip with the tracking overlay, evidence frame, or synthetic test strip |
| `src/components/Readout.tsx` | Verdict, speed, the app's answer, the gates (revealed like a measurement in progress), the record |
| `src/components/ClipList.tsx`, `OwnClipForm.tsx`, `ReadingsView.tsx`, `MethodView.tsx` | The rest of the page |
| `src/lib/` | Formatting, the gate checklist, the Fast/Slow/Stagnant answer |
| `src/data/` | The offline snapshot of real readings, and the synthetic test clips |
| `src/styles/app.css` | All the styles (light theme only) |
| `public/img/evidence/` | Pictures for the offline snapshot |
