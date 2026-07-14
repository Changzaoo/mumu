import { describe, expect, it } from 'vitest';
import {
  curadorLimpaUploader,
  extrator,
  juizCreditoConflita,
  juizDecideCredito,
} from '@/lib/local/metaTeam';

describe('CURADOR — limpeza de uploader', () => {
  it('remove sufixos de canal (" - Topic", VEVO, Oficial)', () => {
    expect(curadorLimpaUploader('Brandão85 - Topic')).toBe('Brandão85');
    expect(curadorLimpaUploader('MatuêVEVO')).toBe('Matuê');
    expect(curadorLimpaUploader('Charlie Brown Jr Oficial')).toBe('Charlie Brown Jr');
  });

  it('descarta canais agregadores — nunca viram crédito de artista', () => {
    expect(curadorLimpaUploader('Trap Lyrics BR')).toBeNull();
    expect(curadorLimpaUploader('Playlists do Momento')).toBeNull();
    expect(curadorLimpaUploader('XYZ Records')).toBeNull();
  });

  it('descarta vazio/curto demais', () => {
    expect(curadorLimpaUploader('')).toBeNull();
    expect(curadorLimpaUploader(null)).toBeNull();
    expect(curadorLimpaUploader('🔥')).toBeNull();
  });
});

describe('JUIZ — precedência de evidência', () => {
  it('artista estruturado da fonte (YouTube Music) vence tudo', () => {
    const credito = juizDecideCredito(
      extrator({
        artist: 'Brandão85',
        track: 'MILAGRE',
        album: 'TRAP MIX TAPE 2',
        uploader: 'Outro Canal Qualquer',
        title: 'MILAGRE (Official Video)',
      }),
    );
    expect(credito).toMatchObject({
      artist: 'Brandão85',
      title: 'MILAGRE',
      album: 'TRAP MIX TAPE 2',
      procedencia: 'fonte',
    });
  });

  it('título "Artista - Título" vence o uploader', () => {
    const credito = juizDecideCredito(
      extrator({ title: 'Matuê - Kenny G.mp3', uploader: 'Canal de Reupload' }),
    );
    expect(credito).toMatchObject({ artist: 'Matuê', title: 'Kenny G', procedencia: 'titulo' });
  });

  it('faixa underground com título simples cai no canal do uploader — nunca "Desconhecido"', () => {
    const credito = juizDecideCredito(
      extrator({ title: 'BLUNT DE GOIABA.mp3', uploader: 'Brandão85' }),
    );
    expect(credito).toMatchObject({ artist: 'Brandão85', procedencia: 'uploader' });
  });

  it('sem nenhuma evidência, a única resposta honesta é "Desconhecido"', () => {
    const credito = juizDecideCredito(extrator({ title: 'faixa 07.mp3' }));
    expect(credito.artist).toBe('Desconhecido');
    expect(credito.procedencia).toBe('nenhuma');
  });

  it('mantém o crédito atual quando a fonte não traz nada melhor', () => {
    const credito = juizDecideCredito(extrator({ title: 'Warzone' }), { artist: 'Brandão85' });
    expect(credito).toMatchObject({ artist: 'Brandão85', procedencia: 'atual' });
  });
});

describe('JUIZ — detecção de crédito alucinado (conflito com a fonte)', () => {
  it('flagra "Warzone → The Wanted" quando o vídeo é do canal Brandão85', () => {
    const ev = extrator({ title: 'Warzone', uploader: 'Brandão85' });
    expect(juizCreditoConflita(ev, 'The Wanted')).toBe(true);
  });

  it('NÃO flagra quando o crédito bate com a evidência (com acento/caixa diferentes)', () => {
    const ev = extrator({ title: 'MILAGRE', uploader: 'Brandão85 - Topic' });
    expect(juizCreditoConflita(ev, 'brandao85')).toBe(false);
  });

  it('NÃO flagra quando o artista aparece no próprio título', () => {
    const ev = extrator({ title: 'Charlie Brown Jr - Só Por Uma Noite', uploader: null });
    expect(juizCreditoConflita(ev, 'Charlie Brown Jr')).toBe(false);
  });

  it('sem evidência de artista na fonte, não acusa ninguém', () => {
    const ev = extrator({ title: 'faixa 07' });
    expect(juizCreditoConflita(ev, 'The Wanted')).toBe(false);
  });

  it('crédito "Desconhecido" nunca conflita', () => {
    const ev = extrator({ title: 'Warzone', uploader: 'Brandão85' });
    expect(juizCreditoConflita(ev, 'Desconhecido')).toBe(false);
  });
});
