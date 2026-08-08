/**
 * Pílula "Continuar ouvindo · de {aparelho}" — o outro lado do Spotify Connect.
 *
 * O `RemotePlaybackBanner` cobre o caso de OUTRO aparelho estar tocando AGORA.
 * Este cobre o que o dono pediu: você pausou no celular, abre no computador e
 * quer continuar de onde parou. O outro aparelho não está tocando — só deixou,
 * na presença, a última faixa e a posição. Aparece só quando NADA está carregado
 * aqui (login novo, app recém-aberto), some ao ser dispensada ou ao começar a
 * tocar qualquer coisa. Continuar é um clique — o gesto que o navegador exige.
 */
import { useState, useSyncExternalStore } from 'react';
import { History, X } from 'lucide-react';
import {
  currentDevices,
  currentRemotePlayback,
  retomadaEntreAparelhos,
  subscribeDevices,
  subscribeRemotePlayback,
  transferPlaybackHere,
  type DeviceInfo,
} from '@/lib/devices/presence';
import { usePlayerStore } from '@/stores/playerStore';

const EMPTY: DeviceInfo[] = [];

export function ResumeElsewhereBanner() {
  // Assina a lista de aparelhos só para RE-RENDERIZAR quando ela muda; a decisão
  // real vem de `retomadaEntreAparelhos`, que lê o mesmo estado.
  useSyncExternalStore(subscribeDevices, currentDevices, () => EMPTY);
  // E a reprodução remota ativa, para RECUAR quando o outro banner deve aparecer.
  const remotoTocando = useSyncExternalStore(
    subscribeRemotePlayback,
    currentRemotePlayback,
    () => null,
  );
  const hasTrackHere = usePlayerStore((s) => s.currentTrack !== null);
  const [dispensado, setDispensado] = useState(false);

  // Nada carregado aqui é a deixa: se o usuário já está com uma faixa, não
  // interrompe. Se OUTRO aparelho está tocando agora, quem manda é o banner
  // "Tocando em X". Uma vez dispensado, não volta a insistir nesta sessão.
  const retomada = hasTrackHere || dispensado || remotoTocando ? null : retomadaEntreAparelhos();
  if (!retomada) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-bg-elevated py-1.5 pl-4 pr-1.5 text-[13px] font-medium text-fg shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-border">
        <History className="size-4 shrink-0 text-fg-muted" />
        <button
          type="button"
          onClick={() => {
            void transferPlaybackHere(retomada.deviceId);
            setDispensado(true);
          }}
          className="min-w-0 truncate"
        >
          Continuar <span className="font-semibold">{retomada.title}</span>
          <span className="text-fg-muted"> · de {retomada.deviceName}</span>
        </button>
        <button
          type="button"
          aria-label="Dispensar"
          onClick={() => setDispensado(true)}
          className="grid size-7 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-fg/8 hover:text-fg"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
