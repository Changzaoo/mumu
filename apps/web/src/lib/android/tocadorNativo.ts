/**
 * MANTÉM O APP DE ANDROID VIVO ENQUANTO HÁ MÚSICA (ver ServicoDeReproducao.java).
 *
 * Tocando → pede ao app nativo o serviço de reprodução em primeiro plano, com a
 * faixa na notificação. Pausado por muito tempo → libera (a notificação some e
 * o sistema pode voltar a economizar bateria). Fora do app (navegador), nada.
 */
import { usePlayerStore } from '@/stores/playerStore';

interface Tocador {
  manterVivo(opcoes: { titulo: string; artista: string }): Promise<void>;
  liberar(): Promise<void>;
}

/** Pausado há mais que isto: o serviço sai de cena. */
const LIBERAR_APOS_PAUSA_MS = 10 * 60 * 1000;

function tocadorNativo(): Tocador | null {
  const cap = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Tocador?: Tocador } };
    }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.Tocador ?? null;
}

let iniciado = false;

export function iniciarTocadorNativo(): void {
  if (iniciado || typeof window === 'undefined') return;
  const tocador = tocadorNativo();
  // APK antigo (sem o plugin): não há o que fazer daqui.
  if (!tocador) return;
  iniciado = true;

  let chaveAtual = '';
  let liberarTimer: ReturnType<typeof setTimeout> | null = null;

  const aplicar = (): void => {
    const { currentTrack, isPlaying } = usePlayerStore.getState();
    if (isPlaying && currentTrack) {
      if (liberarTimer) clearTimeout(liberarTimer);
      liberarTimer = null;
      const artista = currentTrack.artists.map((a) => a.name).join(', ');
      const chave = `${currentTrack.id}|${artista}`;
      if (chave === chaveAtual) return;
      chaveAtual = chave;
      void tocador.manterVivo({ titulo: currentTrack.title, artista }).catch(() => undefined);
      return;
    }
    // Pausado: NÃO libera na hora — pausa curta (atender uma ligação, trocar de
    // música) não pode derrubar o serviço, senão com a tela apagada o app volta
    // a ser morto no meio do caminho.
    if (!liberarTimer && chaveAtual) {
      liberarTimer = setTimeout(() => {
        liberarTimer = null;
        if (usePlayerStore.getState().isPlaying) return;
        chaveAtual = '';
        void tocador.liberar().catch(() => undefined);
      }, LIBERAR_APOS_PAUSA_MS);
    }
  };

  usePlayerStore.subscribe((s, antes) => {
    if (s.isPlaying !== antes.isPlaying || s.currentTrack?.id !== antes.currentTrack?.id) aplicar();
  });
  aplicar();
}
