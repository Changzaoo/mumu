/**
 * ARNÊS DE REPRODUÇÃO — um `<audio>` de mentira que sabe falhar do jeito certo.
 *
 * Os defeitos que este projeto precisa prender não acontecem no caminho feliz.
 * Eles acontecem quando `play()` REJEITA no meio de uma troca de faixa, quando
 * `duration` volta `NaN` porque o servidor não mandou `Content-Length`, quando o
 * elemento simplesmente não emite evento nenhum. O jsdom não faz nada disso: o
 * `HTMLAudioElement` dele tem `play()` que resolve, `duration` sempre `NaN` e
 * nenhuma máquina de eventos. Testar contra ele é testar contra silêncio.
 *
 * ── O CASO QUE MOTIVOU O ARNÊS ──
 *
 * `AbortError` é o que o navegador entrega quando um `play()` ainda pendente é
 * interrompido por um `load()`/`pause()` — ou seja, EM TODA troca de faixa
 * rápida. Não é erro: é o navegador dizendo "esse pedido ficou obsoleto". Quem
 * o trata como falha de reprodução mostra "reprodução bloqueada" para quem só
 * apertou "próxima" duas vezes, e é exatamente o que RF1 proíbe.
 *
 * Nenhum mock pronto do projeto dá `AbortError` sob demanda nem `duration`
 * controlável — daí este arquivo, e não uma biblioteca.
 *
 * Ele NÃO é um arquivo de teste (o vitest só coleta `*.test.ts`); é a ferramenta
 * que os testes de áudio importam.
 */
import { vi } from 'vitest';

/** O erro exato que o navegador lança ao abortar um `play()` pendente. */
export function erroDeAbortar(): DOMException {
  // `DOMException` existe no jsdom; o `name` é o que o código sob teste lê.
  return new DOMException('The play() request was interrupted.', 'AbortError');
}

/** O erro de política de autoplay — outra coisa, e tem que ser tratado como tal. */
export function erroDeAutoplay(): DOMException {
  return new DOMException('play() failed because the user didn’t interact.', 'NotAllowedError');
}

/** Como o próximo `play()` deste elemento deve terminar. */
export type ModoDePlay = 'ok' | 'abortar' | 'bloqueado' | 'pendurar';

export interface ElementoFalsoOpcoes {
  /** Valor inicial de `duration`. `NaN` é o padrão do navegador antes da metadata. */
  duracaoInicial?: number;
  /** Modo do primeiro `play()`. Pode ser trocado a qualquer momento. */
  modoDePlay?: ModoDePlay;
}

/**
 * Um `HTMLAudioElement` de mentira com máquina de eventos de verdade.
 *
 * O que ele expõe além do elemento real, e por quê:
 *  - `modoDePlay`: decide se o próximo `play()` resolve, rejeita com
 *    `AbortError`/`NotAllowedError`, ou nunca resolve (fonte pendurada);
 *  - `emitir`/`chegouMetadata`/`terminou`/`falhou`: dispara eventos na ordem que
 *    o navegador dispararia, sem esperar rede nenhuma;
 *  - `playsPedidos`: quantas vezes o player pediu para tocar — a contagem é o que
 *    prova que evento de slot velho foi DESCARTADO e não reprocessado.
 */
export class ElementoDeAudioFalso extends EventTarget {
  src = '';
  crossOrigin: string | null = null;
  preload = '';
  currentTime = 0;
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  paused = true;
  ended = false;
  duration: number;
  readyState = 0;

  /** Modo do PRÓXIMO `play()`. Os testes trocam isto no meio da encenação. */
  modoDePlay: ModoDePlay;
  /** Quantos `play()` foram pedidos — inclusive os que rejeitaram. */
  playsPedidos = 0;
  /** Quantos `pause()` foram pedidos. */
  pausesPedidos = 0;

  /** Ranges vazios por padrão; `bufferarAte` os preenche. */
  private bufferadoAte = 0;
  private seekavelAte = 0;

  constructor(opcoes: ElementoFalsoOpcoes = {}) {
    super();
    this.duration = opcoes.duracaoInicial ?? Number.NaN;
    this.modoDePlay = opcoes.modoDePlay ?? 'ok';
  }

  play = (): Promise<void> => {
    this.playsPedidos++;
    switch (this.modoDePlay) {
      case 'abortar':
        return Promise.reject(erroDeAbortar());
      case 'bloqueado':
        return Promise.reject(erroDeAutoplay());
      case 'pendurar':
        return new Promise<void>(() => undefined); // nunca resolve, como fonte morta
      default:
        this.paused = false;
        return Promise.resolve();
    }
  };

  pause = (): void => {
    this.pausesPedidos++;
    this.paused = true;
    this.emitir('pause');
  };

  load = (): void => {
    this.readyState = 0;
  };

  removeAttribute = (): void => {
    this.src = '';
  };

  canPlayType = (): string => ''; // sem HLS nativo, como o Chrome

  get buffered(): TimeRanges {
    return faixasDeTempo(this.bufferadoAte);
  }

  get seekable(): TimeRanges {
    return faixasDeTempo(this.seekavelAte);
  }

  // ── encenação ────────────────────────────────────────────────────

  /** Dispara um evento pelo nome, como o navegador faria. */
  emitir(nome: string): void {
    this.dispatchEvent(new Event(nome));
  }

  /** A metadata chegou: define `duration` e dispara os eventos na ordem real. */
  chegouMetadata(duracao: number): void {
    this.duration = duracao;
    this.readyState = 1;
    this.emitir('loadedmetadata');
    this.emitir('durationchange');
  }

  /** Há bytes suficientes para começar — é o que `canplay` significa. */
  daParaComecar(): void {
    this.readyState = 3;
    this.emitir('canplay');
  }

  /** A faixa chegou ao fim. */
  terminou(): void {
    this.ended = true;
    this.paused = true;
    this.emitir('ended');
  }

  /** A fonte não carrega (404/403 do cofre, CORS, arquivo corrompido). */
  falhou(): void {
    this.emitir('error');
  }

  /** Preenche `buffered`/`seekable` até `segundos` — o "está chegando byte". */
  bufferarAte(segundos: number): void {
    this.bufferadoAte = segundos;
    this.seekavelAte = segundos;
  }

  /** Anda o playhead e avisa, como o `timeupdate` do elemento real. */
  avancarPara(segundos: number): void {
    this.currentTime = segundos;
    this.emitir('timeupdate');
  }
}

/** `TimeRanges` mínimo — o AudioEngine só usa `length`/`start`/`end`. */
function faixasDeTempo(fim: number): TimeRanges {
  const vazio = fim <= 0;
  return {
    length: vazio ? 0 : 1,
    start: () => 0,
    end: () => fim,
  } as unknown as TimeRanges;
}

/**
 * Substitui o `Audio`/`HTMLAudioElement` globais pelo arnês durante um teste.
 *
 * Devolve a lista viva dos elementos criados (índice 0 = o primeiro) e a função
 * de restauração. A lista é o que permite afirmar a regra de RNF5: **no máximo
 * um elemento com `paused === false`** depois de N trocas.
 */
export function instalarArnesDeAudio(opcoes: ElementoFalsoOpcoes = {}): {
  criados: ElementoDeAudioFalso[];
  tocando: () => ElementoDeAudioFalso[];
  /**
   * Modo de `play()` dos elementos criados DAQUI EM DIANTE.
   *
   * Precisa ser antes da criação, não depois: o motor chama `play()` dentro do
   * próprio `load()`, então um modo definido no elemento já pronto chegaria
   * tarde demais para o primeiro `play()` — que é justamente o que aborta numa
   * troca rápida.
   */
  definirModoPadrao: (modo: ModoDePlay) => void;
  restaurar: () => void;
} {
  const criados: ElementoDeAudioFalso[] = [];
  const atuais: ElementoFalsoOpcoes = { ...opcoes };
  const Fabrica = function (this: unknown): ElementoDeAudioFalso {
    const el = new ElementoDeAudioFalso(atuais);
    criados.push(el);
    return el;
  } as unknown as typeof Audio;

  const audioAntes = globalThis.Audio;
  vi.stubGlobal('Audio', Fabrica);

  return {
    criados,
    tocando: () => criados.filter((el) => !el.paused),
    definirModoPadrao: (modo) => {
      atuais.modoDePlay = modo;
    },
    restaurar: () => {
      vi.stubGlobal('Audio', audioAntes);
    },
  };
}
