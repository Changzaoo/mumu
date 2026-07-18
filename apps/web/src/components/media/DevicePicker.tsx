/**
 * Seletor de aparelhos + controle remoto (estilo Spotify Connect).
 *
 * Lista os aparelhos da conta, mostra qual está tocando o quê, e permite
 * comandar o que está tocando (pausar, pular, volume) ou puxar a reprodução
 * para cá.
 *
 * **Por que "tocar" só aparece no aparelho ATUAL:** o navegador exige um gesto
 * do usuário para começar a tocar áudio. Mandar "toque" para um aparelho
 * parado, que ninguém tocou, seria recusado pelo navegador — então não
 * oferecemos um botão que mente. Comandar quem JÁ toca funciona sempre, e
 * "trazer para cá" é gesto por definição.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Laptop,
  MonitorSpeaker,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Smartphone,
  Volume2,
} from 'lucide-react';
import {
  currentDevices,
  getDeviceId,
  sendCommand,
  subscribeDevices,
  transferPlaybackHere,
  type DeviceInfo,
} from '@/lib/devices/presence';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: DeviceInfo[] = [];

function DeviceIcon({ name }: { name: string }) {
  const mobile = /iPhone|Android|iPad/i.test(name);
  return mobile ? <Smartphone className="size-4" /> : <Laptop className="size-4" />;
}

export interface DevicePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DevicePicker({ open, onOpenChange }: DevicePickerProps) {
  const devices = useSyncExternalStore(subscribeDevices, currentDevices, () => EMPTY);
  const me = getDeviceId();
  const playingElsewhere = devices.find((d) => !d.isSelf && d.isPlaying && d.online);

  // Volume do aparelho remoto: espelha o valor recebido, mas enquanto o dedo
  // está no slider mandamos o comando sem esperar a volta pela nuvem.
  const [pendingVolume, setPendingVolume] = useState<number | null>(null);
  useEffect(() => {
    if (!open) setPendingVolume(null);
  }, [open]);

  const remoteVolume = pendingVolume ?? playingElsewhere?.volume ?? 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <MonitorSpeaker className="size-4" /> Aparelhos
          </SheetTitle>
        </SheetHeader>

        {/* Controle do aparelho que está tocando lá fora */}
        {playingElsewhere && (
          <div className="mx-4 mb-4 rounded-xl border border-border bg-fg/4 p-4">
            <p className="text-[13px] text-fg-muted">
              Tocando em <span className="font-medium text-fg">{playingElsewhere.name}</span>
            </p>
            {playingElsewhere.track && (
              <p className="mt-1 line-clamp-1 text-sm font-medium text-fg">
                {playingElsewhere.track.title}
                {playingElsewhere.track.artist ? ` · ${playingElsewhere.track.artist}` : ''}
              </p>
            )}

            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                aria-label="Faixa anterior"
                onClick={() => void sendCommand(playingElsewhere.id, 'prev')}
                className="grid size-10 place-items-center rounded-full text-fg-muted hover:bg-fg/8 hover:text-fg"
              >
                <SkipBack className="size-5" />
              </button>
              <button
                type="button"
                aria-label={playingElsewhere.isPlaying ? 'Pausar' : 'Tocar'}
                onClick={() =>
                  void sendCommand(
                    playingElsewhere.id,
                    playingElsewhere.isPlaying ? 'pause' : 'play',
                  )
                }
                className="grid size-12 place-items-center rounded-full bg-accent text-accent-fg"
              >
                {playingElsewhere.isPlaying ? (
                  <Pause className="size-5 fill-current" />
                ) : (
                  <Play className="size-5 fill-current" />
                )}
              </button>
              <button
                type="button"
                aria-label="Próxima faixa"
                onClick={() => void sendCommand(playingElsewhere.id, 'next')}
                className="grid size-10 place-items-center rounded-full text-fg-muted hover:bg-fg/8 hover:text-fg"
              >
                <SkipForward className="size-5" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-3">
              <Volume2 className="size-4 shrink-0 text-fg-muted" />
              <Slider
                aria-label="Volume do aparelho remoto"
                value={[remoteVolume * 100]}
                max={100}
                step={1}
                onValueChange={([v]) => setPendingVolume((v ?? 0) / 100)}
                onValueCommit={([v]) =>
                  void sendCommand(playingElsewhere.id, 'volume', (v ?? 0) / 100)
                }
              />
            </div>

            <button
              type="button"
              onClick={() => {
                void transferPlaybackHere(playingElsewhere.id);
                onOpenChange(false);
              }}
              className="mt-4 w-full rounded-lg bg-fg/8 py-2.5 text-[13px] font-semibold text-fg transition-colors hover:bg-fg/12"
            >
              Ouvir neste aparelho
            </button>
          </div>
        )}

        <ul className="space-y-1 px-4 pb-6">
          {devices.length === 0 && (
            <li className="py-6 text-center text-[13px] text-fg-muted">
              Nenhum outro aparelho conectado nesta conta.
            </li>
          )}
          {devices.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                disabled={device.isSelf || !device.online}
                onClick={() => {
                  void transferPlaybackHere(device.id);
                  onOpenChange(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                  device.isSelf || !device.online ? 'opacity-70' : 'hover:bg-fg/6',
                )}
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-full',
                    device.isPlaying ? 'bg-accent text-accent-fg' : 'bg-fg/8 text-fg-muted',
                  )}
                >
                  <DeviceIcon name={device.name} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-fg">{device.name}</span>
                    {device.id === me && (
                      <span className="shrink-0 text-[11px] text-fg-subtle">este aparelho</span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-[12px] text-fg-muted">
                    {!device.online
                      ? 'Offline'
                      : device.isPlaying && device.track
                        ? `Tocando · ${device.track.title}`
                        : 'Disponível'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

/** Botão que abre o seletor — some quando a conta só tem este aparelho. */
export function DevicePickerButton({ className }: { className?: string }) {
  const devices = useSyncExternalStore(subscribeDevices, currentDevices, () => EMPTY);
  const [open, setOpen] = useState(false);
  const hasTrack = usePlayerStore((s) => s.currentTrack !== null);
  const others = devices.filter((d) => !d.isSelf && d.online);
  if (others.length === 0 && !hasTrack) return null;
  const playingElsewhere = others.some((d) => d.isPlaying);

  return (
    <>
      <button
        type="button"
        aria-label="Aparelhos"
        onClick={() => setOpen(true)}
        className={cn(
          'grid size-8 place-items-center rounded-full transition-colors',
          playingElsewhere ? 'text-accent' : 'text-fg-muted hover:text-fg',
          className,
        )}
      >
        <MonitorSpeaker className="size-4" />
      </button>
      <DevicePicker open={open} onOpenChange={setOpen} />
    </>
  );
}
