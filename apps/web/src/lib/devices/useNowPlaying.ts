/**
 * O QUE ESTÁ TOCANDO — aqui ou em outro aparelho — numa forma só.
 *
 * O usuário não quer pensar "isto toca aqui, aquilo toca lá". Ele quer ver a
 * música na barra do jeito de sempre; se estiver tocando em outro aparelho, a
 * única diferença é um nome pequeno ("moto g", "iPhone") indicando onde. Os
 * controles seguem a música: play/pausar/pular/buscar comandam o aparelho que
 * de fato está tocando (o volume já era assim — ver `useRemoteControl`).
 *
 * A regra: se há faixa carregada AQUI, é a local. Senão, se outro aparelho da
 * conta está tocando, espelha a dele. O progresso remoto avança por um pulso de
 * 1s (o relógio do outro aparelho anda; a presença só publica a cada 2s).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  currentDevices,
  dispositivoRemotoAtivo,
  posicaoEstimada,
  sendCommand,
  subscribeDevices,
  type DeviceInfo,
} from '@/lib/devices/presence';
import { usePlayerStore } from '@/stores/playerStore';
import type { TrackDto } from '@aurial/shared';

type ArtistRef = TrackDto['artists'][number];

const EMPTY: DeviceInfo[] = [];

export interface NowPlaying {
  /** De onde vem: a barra é a mesma; só o `deviceName` muda. */
  source: 'local' | 'remote';
  title: string;
  artists: ArtistRef[];
  coverUrl: string | null;
  isPlaying: boolean;
  /** Nome do aparelho quando é remoto; `null` quando é aqui. */
  deviceName: string | null;
  /** Id do aparelho remoto (para "tocar neste dispositivo"); `null` se local. */
  deviceId: string | null;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
}

export function useNowPlaying(): NowPlaying | null {
  // Reage à lista de aparelhos (outro começou/parou) e ao player local.
  useSyncExternalStore(subscribeDevices, currentDevices, () => EMPTY);
  const localTrack = usePlayerStore((s) => s.currentTrack);
  const localPlaying = usePlayerStore((s) => s.isPlaying);

  const remoto = dispositivoRemotoAtivo();
  // A barra segue QUEM ESTÁ TOCANDO. Um remoto ativamente tocando ganha de uma
  // faixa local carregada e PARADA — senão a música do outro aparelho virava uma
  // pílula flutuante enquanto a barra mostrava a faixa pausada daqui.
  const espelharRemoto = Boolean(remoto?.track && remoto.isPlaying && !localPlaying);

  if (localTrack && !espelharRemoto) {
    const p = usePlayerStore.getState();
    return {
      source: 'local',
      title: localTrack.title,
      artists: localTrack.artists,
      coverUrl: localTrack.coverUrl,
      isPlaying: localPlaying,
      deviceName: null,
      deviceId: null,
      toggle: p.toggle,
      next: p.next,
      prev: p.prev,
      seek: p.seek,
    };
  }

  if (remoto?.track) {
    const id = remoto.id;
    return {
      source: 'remote',
      title: remoto.track.title,
      artists: remoto.track.artist
        ? [{ id: '', name: remoto.track.artist, slug: '', imageUrl: null }]
        : [],
      coverUrl: remoto.track.coverUrl,
      isPlaying: remoto.isPlaying,
      deviceName: remoto.name,
      deviceId: id,
      toggle: () => void sendCommand(id, remoto.isPlaying ? 'pause' : 'play'),
      next: () => void sendCommand(id, 'next'),
      prev: () => void sendCommand(id, 'prev'),
      seek: (seconds: number) => void sendCommand(id, 'seek', seconds),
    };
  }

  return null;
}

/**
 * O RELÓGIO, SEPARADO DO RESTO — e este é um conserto de fluidez, não de estilo.
 *
 * O progresso muda cinco vezes por segundo, para sempre, enquanto houver música.
 * Enquanto ele saía junto de `useNowPlaying`, TODO componente que só queria
 * saber "qual faixa, tocando ou não" era redesenhado cinco vezes por segundo: a
 * barra do player inteira (uns quinze ícones, dois sliders, framer-motion) e o
 * mini player com seu arrasto. Doze quadros de trabalho por segundo gastos para
 * repintar coisas que não mudaram — em celular de entrada isso é a diferença
 * entre rolar liso e engasgar, e é bateria queimada o tempo todo.
 *
 * Agora só quem MOSTRA o tempo assina o tempo. A barra e o mini player só
 * redesenham quando a faixa (ou o play/pause) muda de verdade; o relógio vive
 * dentro de um componente-folha que não tem nada além dele embaixo.
 */
export function useNowPlayingProgress(): { progress: number; duration: number } {
  useSyncExternalStore(subscribeDevices, currentDevices, () => EMPTY);
  const localTrack = usePlayerStore((s) => s.currentTrack);
  const localPlaying = usePlayerStore((s) => s.isPlaying);
  const localProgress = usePlayerStore((s) => s.progress);
  const localDuration = usePlayerStore((s) => s.duration);

  const remoto = dispositivoRemotoAtivo();
  const espelharRemoto = Boolean(remoto?.track && remoto.isPlaying && !localPlaying);

  // Pulso de 1s SÓ quando o relógio mostrado é o de outro aparelho: a presença
  // publica a cada 2s, então sem este tique o seek remoto andaria aos saltos.
  // Com a faixa daqui não existe timer nenhum — o próprio player já emite.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!espelharRemoto) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [espelharRemoto]);

  if (localTrack && !espelharRemoto) {
    return { progress: localProgress, duration: localDuration };
  }
  if (remoto?.track) {
    return { progress: posicaoEstimada(remoto), duration: remoto.duration };
  }
  return { progress: 0, duration: 0 };
}
