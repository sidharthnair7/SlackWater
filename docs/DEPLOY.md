# Deploying SlackWater

## 0. The demo site, with no server (Vercel)

The page runs on its own: with no engine behind it, it shows the saved Geul readings, the 3D views (their points
ship in `frontend/public/points/`) and the on-chain record, and says plainly that measuring uploads needs the engine.

On vercel.com: **Add New → Project →** import `sidharthnair7/SlackWater`, set **Root Directory** to `frontend`,
keep the Vite defaults (build `npm run build`, output `dist`), and deploy. Every push redeploys it.

Checked on 2026-10-04: a clean `npm ci && npm run build` inside `frontend/` alone works, and the built page served
by a plain static server plays the flood clip, loads all 45,000 discs and shows the Basescan link.

The full app (uploads measured live) needs the engine, below. Docker Desktop on Sid's laptop can't start because
the CPU's virtualisation is off; the server build in step 2 doesn't need it.

The app is one Docker image: the Spring Boot server, the page, and the real clips it measures on startup.
Readings live in memory, so every restart re-measures the clips in `clips/seed.csv` and the site is never empty.

**Status:** the Dockerfile has not been built yet. Build it once locally (step 1) before deploying.

## 1. Build and run it locally (needs Docker Desktop running)

```bash
docker build -t slackwater .
docker run --rm -p 8080:8080 slackwater
```

Open http://localhost:8080. The log shows three `Seeded ...` lines: two MOVING and one REFUSED.
`GET /api/readings` should return three readings.

## 2. Put it on a server

Any Linux machine with Docker and about 1 GB of free memory works (JavaCV's native libraries plus Spring).
On the server:

```bash
git clone https://github.com/sidharthnair7/SlackWater.git && cd SlackWater
docker build -t slackwater .
docker run -d --restart unless-stopped --name slackwater -p 8080:8080 slackwater
```

To update after a push: `git pull && docker build -t slackwater . && docker rm -f slackwater`, then the `docker run` line again.

### HTTPS with Caddy (if the server already runs Caddy)

Add a site block and reload Caddy. It fetches the certificate itself, once a DNS record points the name at the server.

```
slackwater.example.com {
    reverse_proxy localhost:8080
}
```

## Notes

- The page is a React app in `frontend/`. The Maven build downloads its own Node and builds it, so the Docker image needs nothing extra, but the first build needs internet access for Node and the npm packages.
- Uploads are capped at 200 MB (`application.properties`).
- The build downloads about 1 GB of Maven dependencies the first time; later builds reuse the cached layer.
- Local development on Windows uses `.mvn/maven.config` (`-Djavacpp.platform=windows-x86_64`); the Dockerfile
  deletes that file inside the build so the Linux libraries are used instead.
