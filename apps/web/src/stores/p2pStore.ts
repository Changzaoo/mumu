/**
 * p2pStore — orchestrates direct peer-to-peer sharing (ARCHITECTURE-P2P §4/§6).
 *
 * Wires the signaling client to a `PeerConnection` + `Transfer` per remote peer.
 * Audio bytes travel only over the WebRTC data channels; the signaling server
 * just relays the handshake. When connected, the user's local library is
 * advertised as a manifest (default: share everything, user-toggleable).
 *
 * Non-serializable objects (sockets, RTCPeerConnections) live at module scope;
 * only plain, render-friendly data lives in the zustand store.
 */
import { create } from 'zustand';
import type { PeerControlMessage, SharedTrackMeta } from '@aurial/shared';
import { PeerConnection } from '@/lib/p2p/peerConnection';
import { Transfer, type TransferProgress } from '@/lib/p2p/transfer';
import { SignalingClient } from '@/lib/p2p/signaling';
import * as localLibrary from '@/lib/local/localLibrary';

export type P2PStatus = 'idle' | 'connecting' | 'connected';

export interface RoomPeer {
  id: string;
  name: string;
}

export interface ActiveTransfer {
  trackId: string;
  peerId: string;
  dir: 'send' | 'receive';
  progress: number;
  done?: boolean;
  error?: boolean;
}

export interface P2PState {
  status: P2PStatus;
  room: string | null;
  myName: string;
  peers: RoomPeer[];
  manifests: Record<string, SharedTrackMeta[]>;
  transfers: Record<string, ActiveTransfer>;
  /** Local track ids currently shared with the room (default: all). */
  sharedTrackIds: Set<string>;

  connect: (room: string, name: string) => void;
  disconnect: () => void;
  requestTrack: (peerId: string, trackId: string) => void;
  toggleShare: (trackId: string) => void;
}

// ── module-scope (non-serializable) glue ────────────────────────
interface PeerRecord {
  conn: PeerConnection;
  transfer: Transfer;
}

let signaling: SignalingClient | null = null;
let myPeerId: string | null = null;
let libUnsub: (() => void) | null = null;
const peers = new Map<string, PeerRecord>();

function transferKey(peerId: string, p: TransferProgress): string {
  return `${peerId}:${p.trackId}:${p.dir}`;
}

export const useP2PStore = create<P2PState>((set, get) => {
  function computeSharedMetas(): SharedTrackMeta[] {
    const shared = get().sharedTrackIds;
    const metas: SharedTrackMeta[] = [];
    for (const entry of localLibrary.list()) {
      if (!shared.has(entry.track.id)) continue;
      const meta = localLibrary.sharedMeta(entry.track.id);
      if (meta) metas.push(meta);
    }
    return metas;
  }

  function advertiseAll(): void {
    for (const { transfer } of peers.values()) transfer.sendManifest();
  }

  function ensurePeer(remoteId: string): PeerRecord {
    const existing = peers.get(remoteId);
    if (existing) return existing;

    const polite = (myPeerId ?? '') > remoteId;
    const conn = new PeerConnection({
      remoteId,
      polite,
      sendSignal: (to, data) => signaling?.send({ t: 'signal', to, data }),
    });

    const transfer = new Transfer({
      channel: conn,
      myName: get().myName,
      getSharedMetas: computeSharedMetas,
      getBlob: (id) => localLibrary.blobFor(id),
      saveReceived: async (meta, blob) => {
        const track = await localLibrary.saveReceivedTrack(meta, blob);
        void import('sonner').then(({ toast }) => toast.success(`Recebido: ${track.title}`));
      },
      onManifest: (metas) => set((s) => ({ manifests: { ...s.manifests, [remoteId]: metas } })),
      onProgress: (progress) => {
        set((s) => ({
          transfers: {
            ...s.transfers,
            [transferKey(remoteId, progress)]: {
              trackId: progress.trackId,
              peerId: remoteId,
              dir: progress.dir,
              progress: progress.progress,
              done: progress.done,
              error: progress.error,
            },
          },
        }));
      },
      onRemoteName: (name) =>
        set((s) => ({
          peers: s.peers.map((p) => (p.id === remoteId ? { ...p, name } : p)),
        })),
    });

    conn.on('open', () => transfer.start());
    conn.on('control', (message: PeerControlMessage) => transfer.handleControl(message));
    conn.on('binary', (buffer) => transfer.handleBinary(buffer));

    const record: PeerRecord = { conn, transfer };
    peers.set(remoteId, record);
    return record;
  }

  return {
    status: 'idle',
    room: null,
    myName: '',
    peers: [],
    manifests: {},
    transfers: {},
    sharedTrackIds: new Set<string>(),

    connect: (room, name) => {
      get().disconnect();

      const shared = new Set(localLibrary.list().map((e) => e.track.id));
      set({
        status: 'connecting',
        room,
        myName: name,
        peers: [],
        manifests: {},
        transfers: {},
        sharedTrackIds: shared,
      });

      const client = new SignalingClient();
      signaling = client;

      client.on('status', (status) => {
        set({
          status: status === 'connected' ? 'connected' : status === 'idle' ? 'idle' : 'connecting',
        });
      });
      client.on('joined', ({ peerId, peers: roomPeers }) => {
        myPeerId = peerId;
        set({ peers: roomPeers.map((p) => ({ id: p.peerId, name: p.name })) });
        for (const p of roomPeers) ensurePeer(p.peerId);
      });
      client.on('peer-joined', ({ peer }) => {
        set((s) =>
          s.peers.some((p) => p.id === peer.peerId)
            ? s
            : { peers: [...s.peers, { id: peer.peerId, name: peer.name }] },
        );
        ensurePeer(peer.peerId);
      });
      client.on('peer-left', ({ peerId }) => {
        peers.get(peerId)?.conn.close();
        peers.delete(peerId);
        set((s) => {
          const manifests = { ...s.manifests };
          delete manifests[peerId];
          return { peers: s.peers.filter((p) => p.id !== peerId), manifests };
        });
      });
      client.on('signal', ({ from, data }) => {
        void ensurePeer(from).conn.handleSignal(data);
      });
      client.on('error', ({ message }) => {
        void import('sonner').then(({ toast }) => toast.error(message));
      });

      // Keep the advertised manifest current as the library changes.
      libUnsub?.();
      libUnsub = localLibrary.subscribe(() => {
        set((s) => {
          const next = new Set(s.sharedTrackIds);
          for (const entry of localLibrary.list()) next.add(entry.track.id);
          return { sharedTrackIds: next };
        });
        advertiseAll();
      });

      client.connect(room, name);
    },

    disconnect: () => {
      libUnsub?.();
      libUnsub = null;
      for (const { conn } of peers.values()) conn.close();
      peers.clear();
      signaling?.disconnect();
      signaling = null;
      myPeerId = null;
      set({ status: 'idle', room: null, peers: [], manifests: {}, transfers: {} });
    },

    requestTrack: (peerId, trackId) => {
      peers.get(peerId)?.transfer.request(trackId);
    },

    toggleShare: (trackId) => {
      set((s) => {
        const next = new Set(s.sharedTrackIds);
        if (next.has(trackId)) next.delete(trackId);
        else next.add(trackId);
        return { sharedTrackIds: next };
      });
      advertiseAll();
    },
  };
});
