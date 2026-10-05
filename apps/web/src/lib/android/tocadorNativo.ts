/**
 * O PLAYER DO SISTEMA NO APP DE ANDROID (ver ServicoDeReproducao.java).
 *
 * Tocando → pede ao app nativo o serviço de reprodução em primeiro plano, que
 * mantém o app vivo com a tela apagada E publica o player do Android: capa,
 * título, anterior · tocar/pausar · próxima e a barra de progresso, na barra de
 * status, na tela de bloqueio e nos botões do fone. Os toques lá voltam para cá
 * pelo evento "comando". Pausado por muito tempo → libera (a notificação some e
 * o sistema pode voltar a economizar bateria). Fora do app (navegador), nada:
 * lá quem cuida é a Media Session do próprio navegador (lib/audio/mediaSession).
 */
import { usePlayerStore } from '@/stores/playerStore';

interface Comando {
  acao: 'tocar' | 'pausar' | 'proxima' | 'anterior' | 'posicionar';
  posicaoMs?: number;
}

interface Tocador {
  manterVivo(opcoes: {
    titulo: string;
    artista: string;
    capa?: string;
    duracaoMs?: number;
    posicaoMs?: number;
    tocando?: boolean;
  }): Promise<void>;
  liberar(): Promise<void>;
  /** Só existe no APK com o player do sistema; no anterior, ninguém emite. */
  addListener?(evento: 'comando', ouvinte: (c: Comando) => void): unknown;
}

/** Pausado há mais que isto: o serviço sai de cena. */
const LIBERAR_APOS_PAUSA_MS = 10 * 60 * 1000;
/**
 * A barra do sistema anda sozinha a partir da última posição avisada. Só vale
 * avisar de novo quando a posição REAL fugiu disso — um salto, não o passo
 * normal do relógio.
 */
const SALTO_S = 2;

function tocadorNativo(): Tocador | null {
  const cap = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Tocador?: Tocador } };
    }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.Tocador ?? null;
}

/** A capa que o app nativo consegue buscar: só endereço de rede (não `blob:`/`data:`). */
function capaDeRede(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const completa = new URL(url, window.location.origin);
    return completa.protocol === 'https:' ? completa.toString() : undefined;
  } catch {
    return undefined;
  }
}

let iniciado = false;

export function iniciarTocadorNativo(): void {
  if (iniciado || typeof window === 'undefined') return;
  const tocador = tocadorNativo();
  // APK antigo (sem o plugin): não há o que fazer daqui.
  if (!tocador) return;
  iniciado = true;

  let servicoVivo = false;
  let liberarTimer: ReturnType<typeof setTimeout> | null = null;
  // O que o sistema acha que está acontecendo, para saber quando corrigi-lo.
  let avisado = { chave: '', tocando: false, duracao: 0, posicao: 0, quando: 0 };

  const enviar = (): void => {
    const { currentTrack, isPlaying, progress, duration } = usePlayerStore.getState();
    if (!currentTrack) return;
    const artista = currentTrack.artists.map((a) => a.name).join(', ');
    avisado = {
      chave: `${currentTrack.id}|${artista}`,
      tocando: isPlaying,
      duracao: duration,
      posicao: progress,
      quando: Date.now(),
    };
    servicoVivo = true;
    void tocador
      .manterVivo({
        titulo: currentTrack.title,
        artista,
        capa: capaDeRede(currentTrack.coverUrl),
        duracaoMs: Math.round((duration || 0) * 1000),
        posicaoMs: Math.round((progress || 0) * 1000),
        tocando: isPlaying,
      })
      .catch(() => undefined);
  };

  const aplicar = (): void => {
    const { currentTrack, isPlaying, progress, duration } = usePlayerStore.getState();
    if (!currentTrack) return;
    const artista = currentTrack.artists.map((a) => a.name).join(', ');
    const chave = `${currentTrack.id}|${artista}`;

    if (isPlaying) {
      if (liberarTimer) clearTimeout(liberarTimer);
      liberarTimer = null;
    } else if (!servicoVivo) {
      // Nunca tocou nesta abertura: o serviço só nasce no primeiro play.
      return;
    } else if (!liberarTimer) {
      // Pausado: NÃO libera na hora — pausa curta (atender uma ligação, trocar
      // de música) não pode derrubar o serviço, senão com a tela apagada o app
      // volta a ser morto no meio do caminho.
      liberarTimer = setTimeout(() => {
        liberarTimer = null;
        if (usePlayerStore.getState().isPlaying) return;
        servicoVivo = false;
        avisado = { chave: '', tocando: false, duracao: 0, posicao: 0, quando: 0 };
        void tocador.liberar().catch(() => undefined);
      }, LIBERAR_APOS_PAUSA_MS);
    }

    // Onde a barra do sistema ESTÁ agora, pelas contas dela.
    const esperada = avisado.tocando
      ? avisado.posicao + (Date.now() - avisado.quando) / 1000
      : avisado.posicao;
    const mudou =
      chave !== avisado.chave ||
      isPlaying !== avisado.tocando ||
      Math.abs(duration - avisado.duracao) > 1 ||
      Math.abs(progress - esperada) > SALTO_S;
    if (mudou) enviar();
  };

  usePlayerStore.subscribe((s, antes) => {
    if (
      s.isPlaying !== antes.isPlaying ||
      s.currentTrack?.id !== antes.currentTrack?.id ||
      s.duration !== antes.duration ||
      s.progress !== antes.progress
    ) {
      aplicar();
    }
  });

  try {
    tocador.addListener?.('comando', (c) => {
      const player = usePlayerStore.getState();
      if (c.acao === 'tocar') player.play();
      else if (c.acao === 'pausar') player.pause();
      else if (c.acao === 'proxima') player.next();
      else if (c.acao === 'anterior') player.prev();
      else if (c.acao === 'posicionar' && typeof c.posicaoMs === 'number') {
        player.seek(c.posicaoMs / 1000);
      }
    });
  } catch {
    /* APK sem o evento: o player do sistema não existe nele */
  }

  aplicar();
}
