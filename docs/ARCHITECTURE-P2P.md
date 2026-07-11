# Aurial — P2P / local-first architecture

> **Pivot.** Aurial is a **local-first, peer-to-peer** music app. Songs live on the
> user's device; users send tracks **directly to each other** over WebRTC. No
> central server ever stores or streams audio. This document supersedes the
> central-streaming design in `ARCHITECTURE.md` (which is kept as an optional
> self-host backend, see §7).

## 1. Principles

1. **Your library is on your device.** Imported files and tracks received from
   friends are stored locally (Cache Storage API / OPFS). The app works fully
   offline.
2. **No central media server.** Audio never transits a server. Peers exchange
   files directly via WebRTC `RTCDataChannel`.
3. **The server is a matchmaker, nothing more.** A tiny WebSocket _signaling_
   service helps two peers find each other and exchange the WebRTC handshake
   (SDP + ICE). It sees no audio, stores nothing to disk, needs no database.
   ~30 MB RAM — runs directly on Node, no Docker, kind to modest hardware.
4. **Privacy by design.** Sharing is opt-in and direct. A peer only sees the
   library you explicitly share, only while you're connected.

## 2. Topology

```
   Browser A (peer)                 Signaling (WS, tiny)                Browser B (peer)
 ┌────────────────┐   room join    ┌───────────────────┐   room join   ┌────────────────┐
 │ local library  │ ─────────────▶ │  in-memory rooms  │ ◀───────────── │ local library  │
 │ (Cache/OPFS)   │   SDP / ICE    │  relays handshake │   SDP / ICE    │ (Cache/OPFS)   │
 │                │ ◀────────────▶ │  (no audio, no DB)│ ◀────────────▶ │                │
 └───────┬────────┘                └───────────────────┘                └───────┬────────┘
         │                                                                      │
         │           WebRTC DataChannel  (audio bytes, direct P2P)              │
         └──────────────────────────────────────────────────────────────────────┘
                         STUN for NAT traversal · TURN only as fallback
```

## 3. Signaling server (`apps/signaling`)

- Standalone Node service using `ws`. **No DB, no Docker, no filesystem writes.**
- State is in-memory: `rooms: Map<roomCode, Map<peerId, socket>>`.
- Messages (JSON):
  - `join { room, name }` → server assigns `peerId`, replies `joined { peerId, peers[] }`,
    and broadcasts `peer-joined { peerId, name }` to the room.
  - `signal { to, data }` → relayed verbatim to the target peer as
    `signal { from, data }` (data = SDP offer/answer or ICE candidate).
  - `leave` / socket close → broadcast `peer-left { peerId }`.
- Heartbeat ping/pong; rooms auto-dispose when empty; per-IP connection cap.
- Deploy: `node dist/server.js` under systemd or PM2. Reverse-proxied by the
  existing system nginx at `/rtc` (WebSocket upgrade). Env: `PORT`, `ORIGIN`
  allowlist, `MAX_CONNECTIONS`.

## 4. Client P2P layer (`apps/web/src/lib/p2p`)

- `signaling.ts` — WebSocket client to the signaling server (auto-reconnect,
  typed messages).
- `peerConnection.ts` — wraps `RTCPeerConnection` + a reliable ordered
  `RTCDataChannel`. Perfect-negotiation pattern (polite/impolite) so either side
  can initiate. STUN servers configurable; optional TURN.
- `protocol.ts` — application protocol over the data channel:
  - control (JSON, text frames): `hello`, `manifest` (shared library list),
    `request { trackId }`, `track-begin { trackId, meta, size }`,
    `track-end { trackId }`, `error`.
  - payload (binary frames): raw file chunks for the in-flight transfer,
    with backpressure via `bufferedAmountLowThreshold`. One transfer at a time
    per peer; receiver reassembles into a `Blob`.
- `stores/p2pStore.ts` (zustand) — connection status, room, peers, each peer's
  shared manifest, active transfers (send/receive progress).

## 5. Local library (`apps/web/src/lib/local`)

- `localLibrary.ts` — the user's own tracks:
  - audio bytes in Cache Storage (`aurial-library-v1`), metadata index in
    localStorage, in-memory object-URL map (same pattern as the offline
    download cache).
  - `importFiles(files)` — reads dropped/picked audio files, derives title from
    filename + tags, duration via a decode probe, stores locally, returns
    `TrackDto`-shaped records (`id = "local:<uuid>"`, `streamUrl = null`).
  - `saveReceivedTrack(meta, blob)` — persists a track received from a peer.
  - `list()`, `remove(id)`, `has(id)`, `localAudioUrl(id)`, `hydrate()`.
- Playback: `AudioEngine` already prefers a local source via the resolver set in
  `playerStore`. The resolver consults **both** the offline-download cache and
  the local library, so imported/received tracks play with no network — the same
  engine, EQ, gapless and crossfade as everything else.

## 6. Sharing UX (`features/share`, `pages/SharePage`, `pages/DevicePage`)

- **DevicePage** (`/dispositivo`) — "No dispositivo": drag-and-drop / file-picker
  import, list of local tracks, play, remove, storage usage.
- **SharePage** (`/compartilhar`) — create or join a room by short code; see
  connected peers; browse a peer's shared library; tap **Receber** to pull a
  track (transfer progress) into your local library; choose which of your tracks
  to share. Everything direct, peer-to-peer.
- Received tracks land in the local library and are immediately playable and
  re-shareable.

## 7. Optional self-host backend (`apps/api`)

The original central backend (Express + Prisma + Redis + BullMQ + FFmpeg + HLS)
remains in the repo as an **optional** component for users who _want_ a personal
cloud library / streaming server. It is not required for the P2P experience and
is not part of the default deploy. See `ARCHITECTURE.md`.

## 8. Deploy

- **Frontend** → Vercel (static PWA, HTTPS — required for Cache Storage / secure
  context and getUserMedia-free WebRTC data channels work on HTTPS).
- **Signaling** → the LAN/Tailscale Linux box, `node dist/server.js` on the root
  disk (no SD card, no Docker). Tailscale/HTTPS gives a secure origin.
- No database, no object storage, no media pipeline in the default topology.

## 9. Limits & future

- NAT traversal: STUN covers most; symmetric-NAT peers need a TURN relay
  (documented, optional — TURN relays bytes, so it's opt-in to preserve the
  no-central-media property).
- Group sharing, resumable transfers, library sync across a user's own devices,
  and content-addressed dedup are natural next steps.
