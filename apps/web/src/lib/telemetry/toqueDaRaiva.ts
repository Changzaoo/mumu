/**
 * O TOQUE DA RAIVA — o mesmo botão apertado três vezes seguidas sem nada mudar.
 *
 * Quando um controle não responde, a pessoa não escreve um relato: ela aperta
 * de novo, e de novo. É o sinal mais barato e mais honesto de que algo travou
 * — e ele acontece ANTES de a pessoa desistir e fechar o app. O vigia do menu
 * (`menuTravado.ts`) já flagra o toque num link que não troca a tela; isto
 * generaliza para QUALQUER botão: play que não toca, "próxima" que não avança,
 * curtida que não acende, letra que não abre.
 *
 * A regra: o MESMO alvo acionado `TOQUES` vezes dentro de `JANELA_MS` sem
 * efeito observável. "Efeito observável" é uma FOTO do estado que a pessoa
 * enxerga — rota pintada, faixa atual, tocando/pausado, telas abertas — tirada
 * em cada toque; se a foto mudou entre dois toques, o toque anterior teve
 * efeito e a sequência recomeça. Play/pausa alternando três vezes não é raiva;
 * três "próxima" na mesma faixa é.
 *
 * O flagrante vai para o diário de bordo como `raiva-<área>` (player, menu ou
 * toque), no mesmo molde das linhas `menu-*`: alvo, contagem, rota e estado do
 * player. Só o diário — nada novo sai do aparelho além do que a telemetria já
 * manda. O detector não interfere no toque: é só um ouvinte na fase de captura.
 */
import { anotar } from '@/lib/telemetry/diario';
import { descrever, rotaPintada } from '@/lib/telemetry/menuTravado';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

/** Quantos toques iguais, sem efeito, viram um flagrante. */
export const TOQUES = 3;
/** Dentro de quanto tempo, contado do primeiro toque da sequência. */
export const JANELA_MS = 4_000;

/** O que se considera "acionar": botões e links. Slider e campo de texto não. */
const SELETOR = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"]';

interface Sequencia {
  alvo: string;
  foto: string;
  inicio: number;
  n: number;
}

/**
 * O núcleo, sem DOM nem relógio: recebe cada toque com o alvo, a foto do
 * estado e a hora, e devolve a contagem quando a sequência vira flagrante
 * (em `TOQUES`, `2×TOQUES`…), ou `null`.
 */
export class DetectorDeRaiva {
  private seq: Sequencia | null = null;

  constructor(
    private readonly toques = TOQUES,
    private readonly janelaMs = JANELA_MS,
  ) {}

  registrar(alvo: string, foto: string, agoraMs: number): number | null {
    const s = this.seq;
    const mesma =
      s !== null && s.alvo === alvo && s.foto === foto && agoraMs - s.inicio <= this.janelaMs;
    if (!mesma) {
      this.seq = { alvo, foto, inicio: agoraMs, n: 1 };
      return null;
    }
    s.n++;
    return s.n % this.toques === 0 ? s.n : null;
  }

  /** Quanto tempo a sequência em curso já dura (0 sem sequência). */
  duracao(agoraMs: number): number {
    return this.seq ? agoraMs - this.seq.inicio : 0;
  }

  zerar(): void {
    this.seq = null;
  }
}

/** A foto do estado que a pessoa enxerga. Mudou = o toque anterior teve efeito. */
export function fotografar(): string {
  const p = usePlayerStore.getState();
  const u = useUiStore.getState();
  const dialogos = document.querySelectorAll(
    '[role="dialog"],[role="alertdialog"],[role="menu"]',
  ).length;
  return [
    rotaPintada() || location.pathname,
    p.currentTrack?.id ?? '-',
    p.isPlaying ? 'tocando' : 'pausado',
    u.nowPlayingOpen ? 'cheia' : '',
    u.lyricsOpen ? 'letra' : '',
    u.queueOpen ? 'fila' : '',
    String(dialogos),
  ].join('|');
}

/** Onde o botão fica: decide o nome do evento (`raiva-player`, `raiva-menu`, `raiva-toque`). */
export function areaDo(el: Element): 'player' | 'menu' | 'toque' {
  if (el.closest('footer, [aria-label="Tocando agora"]')) return 'player';
  if (el.closest('nav, aside, [role="dialog"], [role="menu"]')) return 'menu';
  return 'toque';
}

/** Etiqueta do alvo: o rótulo que a pessoa lê, senão a descrição do elemento. */
export function rotuloDo(el: Element): string {
  const rotulo = el.getAttribute('aria-label') ?? el.getAttribute('title');
  if (rotulo) return rotulo.slice(0, 40);
  const texto = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return texto ? texto.slice(0, 40) : descrever(el);
}

function estadoDoPlayer(): string {
  const p = usePlayerStore.getState();
  const partes = [
    p.isPlaying ? 'tocando' : 'pausado',
    p.isBuffering ? 'buffer' : '',
    p.carga ? `carga=${p.carga.fase}` : '',
    p.currentTrack ? `faixa=${p.currentTrack.title.slice(0, 30)}` : 'sem faixa',
  ];
  return partes.filter(Boolean).join(' ');
}

let instalado = false;

export function instalarDetectorDeRaiva(detector = new DetectorDeRaiva()): void {
  if (instalado || typeof document === 'undefined') return;
  instalado = true;
  document.addEventListener(
    'click',
    (ev: MouseEvent) => {
      if (ev.button !== 0) return;
      const alvoEl = (ev.target as Element | null)?.closest?.(SELETOR) ?? null;
      if (!alvoEl) return;
      const area = areaDo(alvoEl);
      const rotulo = rotuloDo(alvoEl);
      const alvo = `${area}:${rotulo}`;
      const agora = performance.now();
      const n = detector.registrar(alvo, fotografar(), agora);
      if (n === null) return;
      anotar(
        'erro',
        `raiva-${area}`,
        `${rotulo} ×${n} em ${Math.round(detector.duracao(agora))} ms · rota=${rotaPintada() || location.pathname} · ${estadoDoPlayer()}`,
      );
    },
    { capture: true },
  );
}
