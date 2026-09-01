/**
 * UMA PERGUNTA PELAS CHAVES, E ELA NÃO PODE CONFUNDIR CAPA COM ÁUDIO.
 *
 * `indexarAudioLocal` perguntava `hasAudio(id)` uma vez POR FAIXA no boot — uma
 * transação de IndexedDB cada. Medido em `e2e/desempenho.spec.ts`: 2.730ms de
 * tela congelada no desktop com 5.000 faixas, 1.845ms num celular a 6×. Era o
 * maior custo de abertura do app. `allAudioIds()` troca isso por uma leitura só.
 *
 * O RISCO QUE ESTE ARQUIVO GUARDA: capa embutida e áudio dividem o MESMO object
 * store — a capa sob `cover:<id>` (ver `putCover`). Uma leitura de chaves que
 * não descarte esse prefixo contaria toda faixa com capa guardada como faixa com
 * ÁUDIO local. O estrago não seria de desempenho: a faixa passaria a se anunciar
 * tocável offline e emudeceria na hora do play, que é pior que se declarar
 * indisponível desde o começo.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { allAudioIds, putAudio, putCover, deleteAudio } from '@/lib/offline/audioCache';

const bytes = (): Blob => new Blob(['x'.repeat(32)], { type: 'audio/mpeg' });
const imagem = (): Blob => new Blob(['y'.repeat(32)], { type: 'image/jpeg' });

beforeEach(async () => {
  // O store é compartilhado entre os testes deste arquivo; limpa o que ficou.
  for (const id of await allAudioIds()) await deleteAudio(id);
});

describe('allAudioIds — as chaves de áudio, de uma vez', () => {
  it('devolve os ids que têm áudio gravado', async () => {
    await putAudio('local:a', bytes());
    await putAudio('local:b', bytes());

    const ids = await allAudioIds();

    expect(ids.has('local:a')).toBe(true);
    expect(ids.has('local:b')).toBe(true);
    expect(ids.size).toBe(2);
  });

  // ── A TRAVA QUE IMPORTA ──────────────────────────────────────────────────
  it('CAPA NÃO É ÁUDIO: a chave `cover:` fica de fora', async () => {
    await putCover('local:so-capa', imagem());

    const ids = await allAudioIds();

    // Sem o filtro de prefixo, esta faixa entraria como "tem áudio aqui" e
    // passaria a prometer reprodução offline que não existe.
    expect(ids.has('local:so-capa')).toBe(false);
    expect(ids.has('cover:local:so-capa')).toBe(false);
    expect(ids.size).toBe(0);
  });

  it('faixa com áudio E capa entra uma vez só, pelo áudio', async () => {
    await putAudio('local:completa', bytes());
    await putCover('local:completa', imagem());

    const ids = await allAudioIds();

    expect(ids.has('local:completa')).toBe(true);
    expect(ids.size).toBe(1);
  });

  it('cofre vazio devolve conjunto vazio, não erro', async () => {
    expect((await allAudioIds()).size).toBe(0);
  });

  it('áudio apagado some das chaves', async () => {
    await putAudio('local:temporaria', bytes());
    expect((await allAudioIds()).has('local:temporaria')).toBe(true);

    await deleteAudio('local:temporaria');

    expect((await allAudioIds()).has('local:temporaria')).toBe(false);
  });
});
