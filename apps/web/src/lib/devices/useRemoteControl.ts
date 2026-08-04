/**
 * Faz os controles de sempre (volume, play/pause, pular) valerem para o
 * aparelho que está REALMENTE tocando.
 *
 * O usuário não pensa "isto é um controle local, aquilo é um controle remoto".
 * Ele vê a música tocando na sala, pega o telefone e abaixa o volume. Antes,
 * isso mexia no alto-falante mudo do telefone e o som da sala seguia alto.
 */
import { useCallback, useSyncExternalStore } from 'react';
import {
  currentDevices,
  remoteControlTarget,
  sendCommand,
  subscribeDevices,
  type DeviceInfo,
} from '@/lib/devices/presence';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: DeviceInfo[] = [];

export interface RemoteControl {
  /** Aparelho para onde os comandos vão, ou `null` quando é aqui mesmo. */
  target: DeviceInfo | null;
  /** Volume a MOSTRAR: o do aparelho remoto quando há um. */
  volume: number;
  /** Aplica o volume onde ele é audível. */
  setVolume: (value: number) => void;
}

export function useRemoteControl(): RemoteControl {
  // Assinar a lista inteira é o que faz o hook reagir: `remoteControlTarget()`
  // lê o mesmo estado, e sem a assinatura o componente não re-renderizaria
  // quando o outro aparelho começasse (ou parasse) de tocar.
  useSyncExternalStore(subscribeDevices, currentDevices, () => EMPTY);
  const localVolume = usePlayerStore((s) => s.volume);
  const setLocalVolume = usePlayerStore((s) => s.setVolume);

  const target = remoteControlTarget();

  const setVolume = useCallback(
    (value: number) => {
      const alvo = remoteControlTarget();
      if (alvo) {
        void sendCommand(alvo.id, 'volume', value);
        return;
      }
      setLocalVolume(value);
    },
    [setLocalVolume],
  );

  return { target, volume: target ? target.volume : localVolume, setVolume };
}
