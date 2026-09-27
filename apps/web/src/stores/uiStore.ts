/**
 * uiStore — ephemeral interface state (except sidebarCollapsed, persisted).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ActiveModal = 'equalizer' | (string & {}) | null;

export interface UiState {
  /** Persisted: sidebar in 72px icon mode. */
  sidebarCollapsed: boolean;
  queueOpen: boolean;
  nowPlayingOpen: boolean;
  /** Lyrics pane inside NowPlaying. */
  lyricsOpen: boolean;
  commandOpen: boolean;
  activeModal: ActiveModal;
  /**
   * DE QUE LADO A PRÓXIMA FAIXA ENTRA — marcado por quem pediu a troca.
   *
   * O player não sabe (nem precisa saber) se o "próxima" veio de um botão, de
   * um arrasto ou do fim natural da faixa; a tela sabe. O botão/gesto carimba
   * aqui a direção ANTES de chamar `next()`/`prev()`, e a capa que entra lê o
   * carimbo (ver `useDirecaoDaTroca`). 1 = próxima (entra pela direita),
   * -1 = anterior (entra pela esquerda), 0 = sem direção (só funde).
   */
  direcaoDaTroca: DirecaoDaTroca;
  /** `Date.now()` do carimbo — carimbo velho não vale para uma troca nova. */
  direcaoMarcadaEm: number;

  toggleSidebar: () => void;
  setQueueOpen: (open: boolean) => void;
  toggleQueue: () => void;
  setNowPlayingOpen: (open: boolean) => void;
  toggleNowPlaying: () => void;
  setLyricsOpen: (open: boolean) => void;
  toggleLyrics: () => void;
  setCommandOpen: (open: boolean) => void;
  toggleCommand: () => void;
  setActiveModal: (modal: ActiveModal) => void;
  marcarDirecaoDaTroca: (direcao: DirecaoDaTroca) => void;
}

export type DirecaoDaTroca = 1 | -1 | 0;

/**
 * A TELA SOBREVIVE À RECARGA.
 *
 * Quando sai versão nova, o app se recarrega sozinho (ver pwa.ts) e a música
 * volta tocando de onde estava — mas a tela voltava fechada: quem estava com a
 * reprodução expandida aberta, lendo a letra, caía na página inicial com o
 * player minimizado. O mesmo numa recarga feita à mão.
 *
 * O que está aberto é gravado A CADA MUDANÇA (não só na hora de recarregar:
 * a primeira atualização depois de um deploy ainda roda o código antigo, que
 * não gravaria nada), no sessionStorage — só desta aba. Recarregar a aba
 * volta como estava; abrir o app de novo (aba nova, app fechado e reaberto)
 * continua começando fechado.
 */
const TELA_KEY = 'aurial:tela-ao-recarregar';
type TelaSalva = Pick<UiState, 'nowPlayingOpen' | 'lyricsOpen' | 'queueOpen'>;

export function guardarTelaParaRecarregar(): void {
  try {
    const { nowPlayingOpen, lyricsOpen, queueOpen } = useUiStore.getState();
    window.sessionStorage.setItem(
      TELA_KEY,
      JSON.stringify({ nowPlayingOpen, lyricsOpen, queueOpen } satisfies TelaSalva),
    );
  } catch {
    /* sem sessionStorage: volta fechada, como antes */
  }
}

function lerTelaSalva(): Partial<TelaSalva> {
  try {
    const bruto = window.sessionStorage.getItem(TELA_KEY);
    if (!bruto) return {};
    const t = JSON.parse(bruto) as Partial<TelaSalva>;
    return {
      nowPlayingOpen: t.nowPlayingOpen === true,
      lyricsOpen: t.lyricsOpen === true,
      queueOpen: t.queueOpen === true,
    };
  } catch {
    return {};
  }
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sidebarCollapsed: false,
      queueOpen: false,
      nowPlayingOpen: false,
      lyricsOpen: false,
      commandOpen: false,
      activeModal: null,
      direcaoDaTroca: 0,
      direcaoMarcadaEm: 0,
      ...(typeof window === 'undefined' ? {} : lerTelaSalva()),

      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setQueueOpen: (queueOpen) => set({ queueOpen }),
      toggleQueue: () => set({ queueOpen: !get().queueOpen }),
      setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
      toggleNowPlaying: () => set({ nowPlayingOpen: !get().nowPlayingOpen }),
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
      toggleLyrics: () => set({ lyricsOpen: !get().lyricsOpen }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      toggleCommand: () => set({ commandOpen: !get().commandOpen }),
      setActiveModal: (activeModal) => set({ activeModal }),
      marcarDirecaoDaTroca: (direcaoDaTroca) =>
        set({ direcaoDaTroca, direcaoMarcadaEm: Date.now() }),
    }),
    {
      name: 'aurial:ui',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);

// Grava a tela a cada mudança do que está aberto (ver "A TELA SOBREVIVE").
if (typeof window !== 'undefined') {
  useUiStore.subscribe((s, antes) => {
    if (
      s.nowPlayingOpen !== antes.nowPlayingOpen ||
      s.lyricsOpen !== antes.lyricsOpen ||
      s.queueOpen !== antes.queueOpen
    ) {
      guardarTelaParaRecarregar();
    }
  });
}
