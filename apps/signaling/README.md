# @aurial/signaling

Tiny WebRTC **signaling** server for Aurial's peer-to-peer sharing. It matches
peers in rooms and relays their SDP/ICE handshakes so they can open a **direct**
WebRTC connection. It never sees, relays or stores audio, and keeps all state in
memory — no database, no disk, no Docker.

## Run

```bash
pnpm --filter @aurial/signaling build
node apps/signaling/dist/server.js
```

Environment:

| Var               | Default | Purpose                          |
| ----------------- | ------- | -------------------------------- |
| `PORT`            | `4100`  | listen port                      |
| `ORIGIN`          | (any)   | comma-separated Origin allowlist |
| `MAX_CONNECTIONS` | `500`   | global connection cap            |
| `MAX_ROOM_SIZE`   | `16`    | peers per room                   |

`GET /` returns `{ status: "ok", rooms, peers }` for health checks.

## Deploy (LAN / Tailscale box)

Runs directly on Node (no Docker). See `infra/systemd/aurial-signaling.service`
and the `/rtc` WebSocket block in `infra/nginx/aurial.site.conf`.

```bash
sudo cp infra/systemd/aurial-signaling.service /etc/systemd/system/
sudo systemctl enable --now aurial-signaling
```
