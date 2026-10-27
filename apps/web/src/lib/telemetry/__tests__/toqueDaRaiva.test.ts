/**
 * O TOQUE DA RAIVA — o mesmo botão três vezes sem nada mudar vira flagrante.
 *
 * O que se prende: três toques no mesmo alvo dentro da janela, com a foto do
 * estado igual, anotam `raiva-<área>` com alvo, contagem, rota e player; toque
 * que mudou algo (faixa, play, rota, tela) recomeça a contagem; toques
 * espaçados além da janela, ou em alvos diferentes, não contam; e o que não é
 * botão (slider, campo) é ignorado.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const anotar = vi.fn();
vi.mock('@/lib/telemetry/diario', () => ({ anotar: (...a: unknown[]) => anotar(...a) }));

const player = {
  currentTrack: { id: 'local:a', title: 'Mundo Fashion' } as { id: string; title: string } | null,
  isPlaying: true,
  isBuffering: false,
  carga: null as { fase: string } | null,
};
vi.mock('@/stores/playerStore', () => ({
  prepararRetomadaTocando: vi.fn(),
  usePlayerStore: { getState: () => player },
}));
const ui = { nowPlayingOpen: false, lyricsOpen: false, queueOpen: false };
vi.mock('@/stores/uiStore', () => ({
  guardarTelaParaRecarregar: vi.fn(),
  useUiStore: { getState: () => ui },
}));

import {
  DetectorDeRaiva,
  JANELA_MS,
  TOQUES,
  instalarDetectorDeRaiva,
} from '@/lib/telemetry/toqueDaRaiva';
import { marcarRotaPintada } from '@/lib/telemetry/menuTravado';

describe('núcleo: DetectorDeRaiva', () => {
  it('acusa no terceiro toque igual dentro da janela, e de novo no sexto', () => {
    const d = new DetectorDeRaiva();
    expect(d.registrar('player:Próxima', 'f1', 0)).toBeNull();
    expect(d.registrar('player:Próxima', 'f1', 800)).toBeNull();
    expect(d.registrar('player:Próxima', 'f1', 1_500)).toBe(TOQUES);
    expect(d.registrar('player:Próxima', 'f1', 2_000)).toBeNull();
    expect(d.registrar('player:Próxima', 'f1', 2_500)).toBeNull();
    expect(d.registrar('player:Próxima', 'f1', 3_000)).toBe(TOQUES * 2);
    expect(d.duracao(3_000)).toBe(3_000);
  });

  it('a foto mudou entre toques: o anterior teve efeito, recomeça', () => {
    const d = new DetectorDeRaiva();
    d.registrar('player:Play', 'tocando', 0);
    d.registrar('player:Play', 'pausado', 500);
    expect(d.registrar('player:Play', 'tocando', 1_000)).toBeNull();
    expect(d.registrar('player:Play', 'tocando', 1_400)).toBeNull();
    expect(d.registrar('player:Play', 'tocando', 1_800)).toBe(TOQUES);
  });

  it('fora da janela não conta; alvo diferente recomeça', () => {
    const d = new DetectorDeRaiva();
    d.registrar('a', 'f', 0);
    d.registrar('a', 'f', 1_000);
    expect(d.registrar('a', 'f', JANELA_MS + 1)).toBeNull();
    d.registrar('b', 'f', JANELA_MS + 100);
    expect(d.registrar('a', 'f', JANELA_MS + 200)).toBeNull();
    expect(d.registrar('a', 'f', JANELA_MS + 300)).toBeNull();
  });
});

describe('no documento', () => {
  beforeAll(() => {
    instalarDetectorDeRaiva();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    anotar.mockClear();
    player.currentTrack = { id: 'local:a', title: 'Mundo Fashion' };
    player.isPlaying = true;
    player.carga = null;
    ui.nowPlayingOpen = false;
    marcarRotaPintada('/liked');
    document.body.innerHTML = `
      <nav><a id="buscar" href="/search">Buscar</a></nav>
      <main><button id="curtir" aria-label="Curtir">♥</button><input id="campo" /></main>
      <footer>
        <button id="proxima" aria-label="Próxima">⏭</button>
        <button id="play" aria-label="Pausar">⏸</button>
        <div id="volume" role="slider" aria-label="Volume"></div>
      </footer>`;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function tocar(id: string): void {
    document
      .getElementById(id)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  }

  it('três "próxima" na mesma faixa, em 2 s: raiva-player com alvo, contagem, rota e player', () => {
    tocar('proxima');
    vi.advanceTimersByTime(900);
    tocar('proxima');
    vi.advanceTimersByTime(900);
    expect(anotar).not.toHaveBeenCalled();
    tocar('proxima');
    expect(anotar).toHaveBeenCalledTimes(1);
    const [canal, evento, detalhe] = anotar.mock.calls[0] as [string, string, string];
    expect(canal).toBe('erro');
    expect(evento).toBe('raiva-player');
    expect(detalhe).toContain('Próxima ×3 em 1800 ms');
    expect(detalhe).toContain('rota=/liked');
    expect(detalhe).toContain('tocando');
    expect(detalhe).toContain('faixa=Mundo Fashion');
  });

  it('"próxima" que trocou a faixa a cada toque não é raiva', () => {
    tocar('proxima');
    player.currentTrack = { id: 'local:b', title: 'B' };
    vi.advanceTimersByTime(500);
    tocar('proxima');
    player.currentTrack = { id: 'local:c', title: 'C' };
    vi.advanceTimersByTime(500);
    tocar('proxima');
    expect(anotar).not.toHaveBeenCalled();
  });

  it('play/pausa alternando não é raiva; play que não pega, é', () => {
    tocar('play');
    player.isPlaying = false;
    vi.advanceTimersByTime(300);
    tocar('play');
    player.isPlaying = true;
    vi.advanceTimersByTime(300);
    tocar('play');
    expect(anotar).not.toHaveBeenCalled();

    player.isPlaying = false;
    player.carga = { fase: 'carregando' };
    tocar('play');
    vi.advanceTimersByTime(300);
    tocar('play');
    vi.advanceTimersByTime(300);
    tocar('play');
    expect(anotar).toHaveBeenCalledTimes(1);
    expect(anotar.mock.calls[0]?.[2]).toContain('pausado carga=carregando');
  });

  it('toques espaçados além da janela não contam', () => {
    tocar('proxima');
    vi.advanceTimersByTime(JANELA_MS / 2 + 100);
    tocar('proxima');
    vi.advanceTimersByTime(JANELA_MS / 2 + 100);
    tocar('proxima');
    expect(anotar).not.toHaveBeenCalled();
  });

  it('link do menu vira raiva-menu; botão solto vira raiva-toque', () => {
    for (let i = 0; i < 3; i++) tocar('buscar');
    for (let i = 0; i < 3; i++) tocar('curtir');
    expect(anotar.mock.calls.map((c) => c[1])).toEqual(['raiva-menu', 'raiva-toque']);
    expect(anotar.mock.calls[0]?.[2]).toContain('Buscar ×3');
    expect(anotar.mock.calls[1]?.[2]).toContain('Curtir ×3');
  });

  it('slider e campo de texto não contam', () => {
    for (let i = 0; i < 4; i++) tocar('volume');
    for (let i = 0; i < 4; i++) tocar('campo');
    expect(anotar).not.toHaveBeenCalled();
  });
});
