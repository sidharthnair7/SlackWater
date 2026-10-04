# Deploying SlackWater

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

- Uploads are capped at 200 MB (`application.properties`).
- The build downloads about 1 GB of Maven dependencies the first time; later builds reuse the cached layer.
- Local development on Windows uses `.mvn/maven.config` (`-Djavacpp.platform=windows-x86_64`); the Dockerfile
  deletes that file inside the build so the Linux libraries are used instead.
