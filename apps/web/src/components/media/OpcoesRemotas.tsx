/**
 * AS OPÇÕES DO "TOCANDO AGORA" QUANDO O SOM SAI DE OUTRO APARELHO.
 *
 * A linha de baixo tinha só o volume: letra, sono, velocidade e equalizador
 * mexiam no áudio DESTE aparelho, que está em silêncio. Agora cada uma vira um
 * comando para quem toca (ver `applyCommand` em presence.ts), e o estado ligado
 * volta pela presença dele — o botão aceso é o de lá, não o daqui.
 *
 * O visualizador de espectro não entra: ele analisa o som que sai daqui.
 */
import { useSyncExternalStore } from 'react';
import {
  Gauge,
  ListPlus,
  MicVocal,
  SlidersHorizontal,
  Smartphone,
  Timer,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { TrackDto } from '@radinho/shared';
import { abrirAdicionarAPlaylist } from '@/components/media/AdicionarAPlaylist';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Slider } from '@/components/ui/slider';
import { PRESET_LABELS, PRESETS_EM_ORDEM } from '@/lib/audio/eqPresets';
import {
  currentDevices,
  sendCommand,
  subscribeDevices,
  transferPlaybackHere,
  type DeviceInfo,
} from '@/lib/devices/presence';
import { useRemoteControl } from '@/lib/devices/useRemoteControl';

const SONO = [15, 30, 45, 60] as const;
const VELOCIDADES = [0.75, 1, 1.25, 1.5, 2] as const;
const NENHUM: DeviceInfo[] = [];

export function OpcoesRemotas({
  deviceId,
  deviceName,
  faixa,
  letraAberta,
  alternarLetra,
}: {
  deviceId: string;
  deviceName: string | null;
  /** A faixa de lá, achada na biblioteca daqui (null enquanto procura). */
  faixa: TrackDto | null;
  letraAberta: boolean;
  alternarLetra: () => void;
}) {
  const aparelhos = useSyncExternalStore(subscribeDevices, currentDevices, () => NENHUM);
  const la = aparelhos.find((d) => d.id === deviceId);
  const controle = useRemoteControl();
  const nome = deviceName ?? 'outro aparelho';

  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {faixa && (
        <IconButton
          aria-label="Adicionar à playlist"
          size="sm"
          onClick={() => abrirAdicionarAPlaylist(faixa)}
        >
          <ListPlus />
        </IconButton>
      )}
      {faixa && (
        <IconButton
          aria-label={letraAberta ? 'Voltar para a capa' : 'Letra'}
          size="sm"
          active={letraAberta}
          onClick={alternarLetra}
        >
          <MicVocal />
        </IconButton>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Equalizador em ${nome}`} size="sm" active={Boolean(la?.eq)}>
            <SlidersHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuLabel>Equalizador em {nome}</DropdownMenuLabel>
          {PRESETS_EM_ORDEM.map((preset, i) => (
            <DropdownMenuItem
              key={preset}
              onSelect={() => void sendCommand(deviceId, 'eqPreset', i)}
            >
              {PRESET_LABELS[preset] ?? preset}
              {la?.eq === preset && <span className="ml-auto text-accent">●</span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            disabled={!la?.eq}
            onSelect={() => void sendCommand(deviceId, 'eqPreset', -1)}
          >
            Desligar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Timer de sono em ${nome}`} size="sm" active={la?.sono != null}>
            <Timer />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuLabel>Timer de sono em {nome}</DropdownMenuLabel>
          {SONO.map((minutos) => (
            <DropdownMenuItem
              key={minutos}
              onSelect={() => void sendCommand(deviceId, 'sleep', minutos)}
            >
              {minutos} minutos
              {la?.sono === minutos && <span className="ml-auto text-accent">●</span>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            disabled={la?.sono == null}
            onSelect={() => void sendCommand(deviceId, 'sleep', 0)}
          >
            Desligar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={`Velocidade em ${nome}`} size="sm" active={(la?.rate ?? 1) !== 1}>
            <Gauge />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuLabel>Velocidade em {nome}</DropdownMenuLabel>
          {VELOCIDADES.map((v) => (
            <DropdownMenuItem key={v} onSelect={() => void sendCommand(deviceId, 'rate', v)}>
              {v}×{(la?.rate ?? 1) === v && <span className="ml-auto text-accent">●</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="ml-1 grid size-9 place-items-center text-fg-muted" aria-hidden>
        {controle.volume === 0 ? (
          <VolumeX className="size-5" />
        ) : controle.volume < 0.5 ? (
          <Volume1 className="size-5" />
        ) : (
          <Volume2 className="size-5" />
        )}
      </span>
      <Slider
        aria-label={`Volume em ${nome}`}
        value={[Math.round(controle.volume * 100)]}
        max={100}
        step={1}
        onValueChange={([v]) => controle.setVolume((v ?? 0) / 100)}
        className="w-32"
      />

      {/* OUVIR AQUI: o som sai deste aparelho, da mesma posição. O clique é o
          gesto que o navegador exige para tocar. */}
      <Button
        variant="outline"
        size="sm"
        className="ml-2"
        onClick={() => void transferPlaybackHere(deviceId)}
      >
        <Smartphone className="size-4" aria-hidden /> Ouvir aqui
      </Button>
    </div>
  );
}
