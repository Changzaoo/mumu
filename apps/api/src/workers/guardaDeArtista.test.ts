/**
 * GUARDA CONTRA ARTISTA INVENTADO — a IA não escreve na faixa um nome que a
 * faixa não prova. (Queixa do dono, 03/11/2026: músicas com o nome de outro
 * artista.)
 */
import { describe, expect, it, vi } from 'vitest';
import {
  confirmarNoDeezer,
  decidirArtistas,
  nomeApareceEm,
  type ContextoDaFaixa,
} from './guardaDeArtista.js';

const ctx = (extra: Partial<ContextoDaFaixa> = {}): ContextoDaFaixa => ({
  tituloAtual: 'Liberdade',
  tituloOriginal: 'MC Ryan SP e MC Davi - Liberdade (DJ Boy) Lançamento 2026',
  artistasAtuais: ['Desconhecido'],
  canal: 'GR6 Explode',
  ...extra,
});

describe('nomeApareceEm — palavras inteiras', () => {
  it('casa sem acento e sem caixa', () => {
    expect(nomeApareceEm('MARÍLIA mendonça', 'Marilia Mendonca - Supera')).toBe(true);
  });
  it('"Ana" não está em "Mariana" nem em "Banana Split"', () => {
    expect(nomeApareceEm('Ana', 'Mariana - Pipoco')).toBe(false);
    expect(nomeApareceEm('Ana', 'Banana Split')).toBe(false);
  });
  it('"Ana" está em "Ana Castela" (palavra inteira) — a régua de vídeo é que desempata', () => {
    expect(nomeApareceEm('Ana', 'Ana Castela - Pipoco')).toBe(true);
  });
  it('nome de uma letra não prova nada', () => {
    expect(nomeApareceEm('A', 'A Banda')).toBe(false);
  });
});

describe('decidirArtistas', () => {
  it('aceita nome que está no título original do vídeo', async () => {
    const d = await decidirArtistas(['MC Ryan SP', 'MC Davi'], ctx());
    expect(d.aceita).toBe(true);
    expect(d.artistas).toEqual(['MC Ryan SP', 'MC Davi']);
  });

  it('aceita nome do canal e dos artistas originais', async () => {
    expect((await decidirArtistas(['GR6 Explode'], ctx())).aceita).toBe(true);
    const c = ctx({ artistasOriginais: ['Liberdade'], tituloOriginal: null });
    expect((await decidirArtistas(['Liberdade'], c)).aceita).toBe(true);
  });

  it('RECUSA nome que não está em lugar nenhum e mantém os atuais', async () => {
    const d = await decidirArtistas(['Gusttavo Lima'], ctx({ artistasAtuais: ['MC Davi'] }));
    expect(d.aceita).toBe(false);
    expect(d.inventados).toEqual(['Gusttavo Lima']);
    expect(d.artistas).toEqual(['MC Davi']);
  });

  it('um nome inventado derruba a reescrita inteira (nada de meio-termo)', async () => {
    const d = await decidirArtistas(['MC Davi', 'Fulano Inventado'], ctx());
    expect(d.aceita).toBe(false);
    expect(d.artistas).toEqual(['Desconhecido']);
  });

  it('a fonte real confirma o que o vídeo não diz', async () => {
    const confirmar = vi.fn(async (_t: string, a: string) => a === 'Gusttavo Lima');
    const d = await decidirArtistas(['Gusttavo Lima'], ctx(), confirmar);
    expect(d.aceita).toBe(true);
    expect(confirmar).toHaveBeenCalledWith('Liberdade', 'Gusttavo Lima');
  });

  it('fonte que falha = sem prova', async () => {
    const d = await decidirArtistas(['Gusttavo Lima'], ctx(), async () => {
      throw new Error('rede');
    });
    expect(d.aceita).toBe(false);
  });

  it('proposta vazia não apaga os artistas', async () => {
    const d = await decidirArtistas([], ctx({ artistasAtuais: ['MC Davi'] }));
    expect(d.aceita).toBe(false);
    expect(d.artistas).toEqual(['MC Davi']);
  });
});

describe('confirmarNoDeezer', () => {
  const resposta = (data: unknown): typeof fetch =>
    (async () => ({ ok: true, json: async () => ({ data }) })) as unknown as typeof fetch;

  it('confirma quando existe faixa com o mesmo título e o mesmo artista', async () => {
    const c = confirmarNoDeezer(resposta([{ title: 'Liberdade', artist: { name: 'MC Davi' } }]));
    expect(await c('Liberdade (Clipe Oficial)', 'MC Davi')).toBe(true);
  });
  it('não confirma artista diferente nem título diferente', async () => {
    const c = confirmarNoDeezer(
      resposta([{ title: 'Liberdade Eterna', artist: { name: 'MC Davi' } }]),
    );
    expect(await c('Liberdade', 'MC Davi')).toBe(false);
    const d = confirmarNoDeezer(resposta([{ title: 'Liberdade', artist: { name: 'Outro' } }]));
    expect(await d('Liberdade', 'MC Davi')).toBe(false);
  });
  it('sem rede, não confirma', async () => {
    const c = confirmarNoDeezer((async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    expect(await c('Liberdade', 'MC Davi')).toBe(false);
  });
});
