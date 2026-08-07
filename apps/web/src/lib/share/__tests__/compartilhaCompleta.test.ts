/**
 * O LINK COMPARTILHADO TEM QUE LEVAR A MÚSICA INTEIRA.
 *
 * O que fazia o visitante ouvir 30 segundos não era uma regra de produto: era
 * `buildStreamUrl` assinar com o token do Firebase de QUEM ESTÁ OUVINDO. Sem
 * conta, sem token; sem token, sobrava a prévia.
 *
 * O conserto é embarcar no compartilhamento a URL da cópia no cofre, que já vem
 * assinada por QUEM COMPARTILHOU. Este teste trava justamente isso: se a URL
 * parar de viajar no payload, o link volta a ser meia música e ninguém percebe
 * até alguém reclamar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTrack } from '@/test/factories';

const remoteUrlFor = vi.fn<(id: string) => string | null>(() => null);
const sourceUrlFor = vi.fn<(id: string) => string | null>(() => null);

vi.mock('@/lib/local/localLibrary', () => ({
  remoteUrlFor: (id: string) => remoteUrlFor(id),
  sourceUrlFor: (id: string) => sourceUrlFor(id),
}));
vi.mock('@/lib/firebase', () => ({ db: null, subscribeAuth: () => () => undefined }));
vi.mock('@/lib/sync/firestoreLazy', () => ({ firestore: async () => ({}) }));

import { tracksToShare } from '@/lib/share/share';

describe('o que viaja no compartilhamento', () => {
  beforeEach(() => {
    remoteUrlFor.mockReset().mockReturnValue(null);
    sourceUrlFor.mockReset().mockReturnValue(null);
  });

  it('leva a cópia do cofre — é ela que toca sem login', () => {
    remoteUrlFor.mockReturnValue('https://cofre/blob/local%3Aa?k=token');
    sourceUrlFor.mockReturnValue('https://fonte/x');

    const [faixa] = tracksToShare([makeTrack('local:a')]);

    expect(faixa?.remoteUrl).toBe('https://cofre/blob/local%3Aa?k=token');
    // O link da fonte continua indo: quem tem conta ainda usa como alternativa.
    expect(faixa?.sourceUrl).toBe('https://fonte/x');
  });

  it('cai para o streamUrl da faixa quando não há cópia registrada', () => {
    remoteUrlFor.mockReturnValue(null);
    const comStream = { ...makeTrack('local:b'), streamUrl: 'https://cofre/outra.mp3' };

    const [faixa] = tracksToShare([comStream]);

    expect(faixa?.remoteUrl).toBe('https://cofre/outra.mp3');
  });

  it('sem cópia nenhuma, o campo vai nulo em vez de sumir', () => {
    const semNada = { ...makeTrack('local:c'), streamUrl: null };

    const [faixa] = tracksToShare([semNada]);

    // `undefined` desapareceria no JSON e o outro lado não saberia distinguir
    // "não tem cópia" de "versão antiga do app que nem mandava o campo".
    expect(faixa?.remoteUrl).toBeNull();
  });

  it('preserva título, artista, capa e duração', () => {
    const [faixa] = tracksToShare([makeTrack('local:d')]);
    expect(faixa?.title).toBeTruthy();
    expect(typeof faixa?.durationMs).toBe('number');
  });
});
