/**
 * O COFRE CHEIO DERRUBAVA O APP INTEIRO — este arquivo reproduz o estrago.
 *
 * O relato foi um despejo de pilha do Firestore por cima do player ("INTERNAL
 * ASSERTION FAILED … The quota has been exceeded … addPendingMutation"), mas o
 * Firestore era a vítima: quem tinha enchido o localStorage era o cache de
 * LETRAS, que crescia sem teto. Com o cofre cheio, tudo que grava ali falha ao
 * mesmo tempo — inclusive a biblioteca do usuário, que some na recarga.
 *
 * A regra que estes testes travam: enfeite nunca derruba o essencial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Cofre from '@/lib/local/cofreLocal';

/** Um localStorage de brinquedo com fundo — o real tem ~5 MB. */
function montarCofre(capacidade: number): Storage {
  const dados = new Map<string, string>();
  const usado = (exceto?: string): number => {
    let total = 0;
    for (const [k, v] of dados) if (k !== exceto) total += k.length + v.length;
    return total;
  };
  return {
    get length(): number {
      return dados.size;
    },
    key: (i: number): string | null => [...dados.keys()][i] ?? null,
    getItem: (k: string): string | null => dados.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      if (usado(k) + k.length + v.length > capacidade) {
        const erro = new Error('The quota has been exceeded.');
        erro.name = 'QuotaExceededError';
        throw erro;
      }
      dados.set(k, v);
    },
    removeItem: (k: string): void => {
      dados.delete(k);
    },
    clear: (): void => dados.clear(),
  } as unknown as Storage;
}

describe('cofre local', () => {
  let cofre: typeof Cofre;

  beforeEach(async () => {
    vi.resetModules(); // os registros vivem no módulo
    cofre = await import('@/lib/local/cofreLocal');
  });

  it('reconhece a cota estourada com o nome de cada navegador', () => {
    const chrome = new Error('quota');
    chrome.name = 'QuotaExceededError';
    const firefox = new Error('persistent storage maximum size reached');
    firefox.name = 'NS_ERROR_DOM_QUOTA_REACHED';

    expect(cofre.ehCotaEstourada(chrome)).toBe(true);
    expect(cofre.ehCotaEstourada(firefox)).toBe(true);
    // O Safari em aba privada chega sem `name` — sobra a mensagem.
    expect(cofre.ehCotaEstourada({ message: 'The quota has been exceeded.' })).toBe(true);
    expect(cofre.ehCotaEstourada(new Error('rede caiu'))).toBe(false);
  });

  it('sacrifica o enfeite para a biblioteca do usuário caber', () => {
    vi.stubGlobal('localStorage', montarCofre(200));
    let letrasEmMemoria: string | null = 'megabytes de letra';
    window.localStorage.setItem('aurial:lyrics-cache', 'x'.repeat(150));
    cofre.registrarDescartavel('aurial:lyrics-cache', 40, () => {
      letrasEmMemoria = null;
    });

    // ESTE era o sintoma: a biblioteca não cabia e sumia na recarga.
    const gravou = cofre.gravarLocal('aurial:library', 'y'.repeat(120));

    expect(gravou).toBe(true);
    expect(window.localStorage.getItem('aurial:library')).toBe('y'.repeat(120));
    expect(window.localStorage.getItem('aurial:lyrics-cache')).toBeNull();
    // Apagar sem avisar o dono seria inútil: ele reescreveria os mesmos
    // megabytes no próximo write() e o cofre encheria de novo em segundos.
    expect(letrasEmMemoria).toBeNull();
  });

  it('sacrifica do mais barato para o mais caro — letra é a última a cair', () => {
    vi.stubGlobal('localStorage', montarCofre(260));
    window.localStorage.setItem('aurial:artist-bios', 'b'.repeat(60));
    window.localStorage.setItem('aurial:lyrics-cache', 'l'.repeat(60));
    cofre.registrarDescartavel('aurial:lyrics-cache', 40, () => undefined);
    cofre.registrarDescartavel('aurial:artist-bios', 20, () => undefined);

    expect(cofre.gravarLocal('aurial:library', 'y'.repeat(100))).toBe(true);
    // Bastou a biografia: a letra, mais cara de refazer, continua lá.
    expect(window.localStorage.getItem('aurial:artist-bios')).toBeNull();
    expect(window.localStorage.getItem('aurial:lyrics-cache')).not.toBeNull();
  });

  it('um enfeite NUNCA despeja outro para caber', () => {
    vi.stubGlobal('localStorage', montarCofre(200));
    window.localStorage.setItem('aurial:lyrics-cache', 'l'.repeat(150));
    cofre.registrarDescartavel('aurial:lyrics-cache', 40, () => undefined);

    // Uma biografia não vale o despejo de uma letra sincronizada.
    expect(cofre.gravarCache('aurial:artist-bios', 'b'.repeat(120), 300_000)).toBe(false);
    expect(window.localStorage.getItem('aurial:lyrics-cache')).not.toBeNull();
  });

  it('cache que passa do próprio teto não é gravado — era assim que o cofre enchia', () => {
    vi.stubGlobal('localStorage', montarCofre(1_000_000));
    expect(cofre.gravarCache('aurial:lyrics-cache', 'x'.repeat(2_000_000), 1_500_000)).toBe(false);
    expect(window.localStorage.getItem('aurial:lyrics-cache')).toBeNull();
  });

  // ── faxina de abertura ───────────────────────────────────────────────────
  // Reagir à falha salva a gravação, mas chega TARDE para quem já abriu o app
  // com o cofre lotado da sessão passada — e foi um cofre lotado que derrubou o
  // Firestore por dentro, num caminho que nem passa pelo nosso código.

  it('cofre folgado: a faxina não apaga nada', () => {
    vi.stubGlobal('localStorage', montarCofre(10_000_000));
    window.localStorage.setItem('aurial:lyrics-cache', 'l'.repeat(1000));
    expect(cofre.arrumarCofre()).toBe(0);
    expect(window.localStorage.getItem('aurial:lyrics-cache')).not.toBeNull();
  });

  it('cofre lotado: abre espaço no boot, do mais barato para o mais caro', () => {
    vi.stubGlobal('localStorage', montarCofre(10_000_000));
    // Passa dos 3 MB que disparam a faxina.
    window.localStorage.setItem('aurial:lyrics-cache', 'l'.repeat(2_000_000));
    window.localStorage.setItem('aurial:artist-bios', 'b'.repeat(900_000));
    window.localStorage.setItem('aurial:coverAttempts', 'c'.repeat(300_000));
    window.localStorage.setItem('aurial:library', 'y'.repeat(200_000));

    expect(cofre.arrumarCofre()).toBeGreaterThan(0);

    // O que é do usuário nunca entra na conta do sacrifício.
    expect(window.localStorage.getItem('aurial:library')).not.toBeNull();
    // Contadores e biografias caem primeiro; a letra é a última.
    expect(window.localStorage.getItem('aurial:coverAttempts')).toBeNull();
    expect(window.localStorage.getItem('aurial:artist-bios')).toBeNull();
    expect(cofre.usoDoCofre().total).toBeLessThanOrEqual(3_000_000);
  });

  it('faxina alcança cache de módulo que nem foi carregado ainda', () => {
    // Quase todo cache entra por import() preguiçoso: no boot, o registro está
    // vazio. Se a faxina dependesse dele, acordaria de mãos vazias justamente
    // no aparelho que está lotado desde a sessão passada.
    vi.stubGlobal('localStorage', montarCofre(10_000_000));
    window.localStorage.setItem('aurial:artist-bios', 'b'.repeat(3_500_000));
    expect(cofre.arrumarCofre()).toBeGreaterThan(0);
    expect(window.localStorage.getItem('aurial:artist-bios')).toBeNull();
  });

  it('quando nem sacrificando tudo cabe, a falha é registrada e não engolida', async () => {
    vi.resetModules();
    const registrar = vi.fn();
    vi.doMock('@/lib/sync/syncStatus', () => ({ registrarFalhaDePersistencia: registrar }));
    const isolado = await import('@/lib/local/cofreLocal');

    vi.stubGlobal('localStorage', montarCofre(50));
    expect(isolado.gravarLocal('aurial:library', 'y'.repeat(500))).toBe(false);
    expect(registrar).toHaveBeenCalledTimes(1);
    vi.doUnmock('@/lib/sync/syncStatus');
  });
});
