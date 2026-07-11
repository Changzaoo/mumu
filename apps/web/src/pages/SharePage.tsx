/**
 * /compartilhar — direct peer-to-peer sharing. Join a room by short code, see
 * connected peers, browse each peer's shared library and pull tracks straight
 * into your device (WebRTC data channel — no server ever touches the audio).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Download,
  Loader2,
  Music,
  RefreshCw,
  Share2,
  Users,
  Wifi,
} from 'lucide-react';
import { MAX_NAME_LEN, MAX_ROOM_LEN, type SharedTrackMeta } from '@aurial/shared';
import { EmptyState } from '@/components/media/EmptyState';
import { Button } from '@/components/ui/button';
import * as localLibrary from '@/lib/local/localLibrary';
import { cn, formatBytes } from '@/lib/utils';
import { useP2PStore } from '@/stores/p2pStore';

const NAME_KEY = 'aurial:p2p-name';
const EMPTY: localLibrary.LibraryEntry[] = [];

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function PeerTrack({ peerId, meta }: { peerId: string; meta: SharedTrackMeta }) {
  const requestTrack = useP2PStore((s) => s.requestTrack);
  const transfer = useP2PStore((s) => s.transfers[`${peerId}:${meta.id}:receive`]);
  const alreadyHave = useSyncExternalStore(
    localLibrary.subscribe,
    () => localLibrary.list().some((e) => e.track.title === meta.title),
    () => false,
  );

  const receiving = transfer && !transfer.done && transfer.progress < 1;
  const done = transfer?.done && !transfer.error;

  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-fg/5">
      <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-fg/6 text-fg-subtle">
        <Music className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium text-fg">{meta.title}</p>
        <p className="line-clamp-1 text-[13px] text-fg-muted">
          {meta.artist} · {formatBytes(meta.sizeBytes)}
        </p>
        {receiving && (
          <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-fg/10">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.round(transfer.progress * 100)}%` }}
            />
          </span>
        )}
      </div>
      {done || alreadyHave ? (
        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-accent">
          <CheckCircle2 className="size-4" /> No dispositivo
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={Boolean(receiving)}
          onClick={() => requestTrack(peerId, meta.id)}
        >
          {receiving ? (
            <>
              <Loader2 className="animate-spin" /> {Math.round((transfer?.progress ?? 0) * 100)}%
            </>
          ) : (
            <>
              <Download /> Receber
            </>
          )}
        </Button>
      )}
    </div>
  );
}

export default function SharePage() {
  const status = useP2PStore((s) => s.status);
  const room = useP2PStore((s) => s.room);
  const peers = useP2PStore((s) => s.peers);
  const manifests = useP2PStore((s) => s.manifests);
  const connect = useP2PStore((s) => s.connect);
  const disconnect = useP2PStore((s) => s.disconnect);

  const localEntries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => {
    try {
      setName(window.localStorage.getItem(NAME_KEY) ?? '');
    } catch {
      /* ignore */
    }
    setCode(randomCode());
  }, []);

  const handleConnect = (): void => {
    const trimmedName = name.trim() || 'Convidado';
    const trimmedRoom = code.trim().toUpperCase();
    if (!trimmedRoom) return;
    try {
      window.localStorage.setItem(NAME_KEY, trimmedName);
    } catch {
      /* ignore */
    }
    connect(trimmedRoom, trimmedName);
  };

  // Leave the room when navigating away.
  useEffect(() => () => disconnect(), [disconnect]);

  const connected = status === 'connected';

  return (
    <div className="space-y-6 py-4">
      <header className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <Share2 className="size-7 text-fg-muted" /> Compartilhar
        </h1>
        <p className="max-w-xl text-sm text-fg-muted">
          Envie e receba músicas direto entre dispositivos, sem servidor no meio. Entre em uma sala
          com um código e compartilhe o código com quem estiver por perto.
        </p>
      </header>

      {/* Connection card */}
      <div className="glass space-y-4 rounded-xl p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-fg-muted">Seu nome</span>
            <input
              value={name}
              maxLength={MAX_NAME_LEN}
              disabled={status !== 'idle'}
              onChange={(e) => setName(e.target.value)}
              placeholder="Como aparecer para os outros"
              className="h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-60"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-fg-muted">Código da sala</span>
            <div className="flex items-center gap-1.5">
              <input
                value={code}
                maxLength={MAX_ROOM_LEN}
                disabled={status !== 'idle'}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ex.: AB12CD"
                className="h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 font-mono text-sm uppercase tracking-widest text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none disabled:opacity-60"
              />
              {status === 'idle' && (
                <button
                  type="button"
                  aria-label="Gerar novo código"
                  onClick={() => setCode(randomCode())}
                  className="grid size-10 shrink-0 place-items-center rounded-lg border border-border text-fg-muted hover:bg-fg/5 hover:text-fg"
                >
                  <RefreshCw className="size-4" />
                </button>
              )}
            </div>
          </label>
          {status === 'idle' ? (
            <Button variant="accent" size="lg" onClick={handleConnect} disabled={!code.trim()}>
              <Wifi /> Entrar
            </Button>
          ) : (
            <Button variant="outline" size="lg" onClick={disconnect}>
              Sair
            </Button>
          )}
        </div>

        {status !== 'idle' && (
          <div className="flex items-center gap-2 text-[13px] text-fg-muted">
            {connected ? (
              <>
                <span className="size-2 rounded-full bg-accent" />
                Conectado à sala <span className="font-mono font-semibold text-fg">
                  {room}
                </span> · {peers.length} {peers.length === 1 ? 'pessoa' : 'pessoas'}
              </>
            ) : (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Conectando…
              </>
            )}
          </div>
        )}
      </div>

      {/* Peers */}
      {connected && peers.length === 0 && (
        <EmptyState
          icon={Users}
          title="Aguardando alguém entrar"
          description={`Compartilhe o código ${room ?? ''} com quem você quer trocar músicas — a pessoa entra na mesma sala e vocês se conectam direto.`}
        />
      )}

      {connected &&
        peers.map((peer) => {
          const tracks = manifests[peer.id] ?? [];
          return (
            <motion.section
              key={peer.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              aria-label={`Biblioteca de ${peer.name}`}
              className="space-y-2"
            >
              <h2 className="flex items-center gap-2 px-2 text-lg font-semibold tracking-tight text-fg">
                <Users className="size-5 text-fg-muted" /> {peer.name}
                <span className="text-[13px] font-normal text-fg-subtle">
                  {tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'}
                </span>
              </h2>
              {tracks.length === 0 ? (
                <p className="px-2 text-[13px] text-fg-muted">
                  Ainda não está compartilhando nada.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {tracks.map((meta) => (
                    <PeerTrack key={meta.id} peerId={peer.id} meta={meta} />
                  ))}
                </div>
              )}
            </motion.section>
          );
        })}

      {/* What you are sharing */}
      <section aria-label="O que você compartilha" className="space-y-2">
        <h2 className="flex items-center gap-2 px-2 text-lg font-semibold tracking-tight text-fg">
          <Share2 className="size-5 text-fg-muted" /> Você compartilha
          {connected && (
            <span className="text-[13px] font-normal text-fg-subtle">· com a sala {room}</span>
          )}
        </h2>
        {localEntries.length === 0 ? (
          <EmptyState
            icon={Music}
            title="Nada para compartilhar ainda"
            description="Importe músicas em No dispositivo para poder enviá-las."
            action={
              <Link
                to="/dispositivo"
                className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent/90"
              >
                Ir para No dispositivo
              </Link>
            }
          />
        ) : (
          <div className="space-y-0.5">
            {localEntries.map((entry) => (
              <div
                key={entry.track.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-2 py-2',
                  connected ? 'text-fg' : 'text-fg-muted',
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-fg/6 text-fg-subtle">
                  <Music className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-medium text-fg">{entry.track.title}</p>
                  <p className="line-clamp-1 text-[13px] text-fg-muted">
                    {entry.track.artists[0]?.name ?? 'Desconhecido'} ·{' '}
                    {formatBytes(entry.sizeBytes)}
                  </p>
                </div>
                {connected && <span className="text-[13px] text-fg-subtle">compartilhado</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
