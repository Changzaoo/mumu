/**
 * O CLIENTE NÃO PODE APAGAR O QUE ELE NUNCA RECEBEU.
 *
 * O `dna` (vetor de 2048 dimensões, ~39 KB por faixa) saiu da listagem porque
 * era 71% do peso do acervo e o app nunca o leu. Mas a gravação substitui o
 * documento INTEIRO — então, sem preservação, a primeira vez que um aparelho
 * republicasse a faixa o vetor iria para o lixo. A curadoria refaria, o cliente
 * apagaria de novo, e o ciclo não terminaria nunca.
 *
 * É o teste que protege os dois lados da mesma moeda: sai na leitura, sobrevive
 * na escrita.
 */
import { describe, expect, it } from 'vitest';
import { comCamposDoServidor, semCamposDoServidor } from './catalog.repository.js';

type Objeto = Record<string, unknown>;

/** Navega a árvore do acervo nos testes sem espalhar `any` pelo arquivo. */
function em(valor: unknown, ...caminho: Array<string | number>): Objeto {
  let atual: unknown = valor;
  for (const passo of caminho) {
    atual = Array.isArray(atual) ? atual[passo as number] : (atual as Objeto)[passo as string];
  }
  return atual as Objeto;
}

const vetor = Array.from({ length: 8 }, (_, i) => i / 10);
const noBanco = {
  track: { id: 'local:1', title: 'Faixa' },
  remoteUrl: 'https://cofre/1',
  dna: vetor,
};

describe('semCamposDoServidor', () => {
  it('tira o dna da listagem e preserva o que a tela desenha', () => {
    const saida = semCamposDoServidor(noBanco);
    expect(saida).not.toHaveProperty('dna');
    expect(saida.track).toEqual({ id: 'local:1', title: 'Faixa' });
  });

  it('a cópia do cofre virou um BIT — o endereço só vem no clique', () => {
    // O contrato mudou de propósito: `remoteUrl` saiu da listagem junto com o
    // resto do conteúdo (ver CAMPOS_SOB_DEMANDA). O que a lista precisa saber
    // é só se a faixa toca, e isso cabe em um bit.
    const saida = semCamposDoServidor(noBanco) as Record<string, unknown>;
    expect('remoteUrl' in saida).toBe(false);
    expect(saida.tocavel).toBe(true);
  });

  it('não copia a FAIXA quando não há nada a tirar dela', () => {
    // A entrada é sempre recriada (ganha o `tocavel`, que é calculado), mas o
    // objeto caro — a faixa — não pode ser copiado à toa: o acervo inteiro fica
    // em cache na memória do servidor.
    const track = { id: 'local:2' };
    const saida = semCamposDoServidor({ track }) as Record<string, unknown>;
    expect(saida.track).toBe(track);
  });
});

describe('comCamposDoServidor', () => {
  it('devolve o dna do banco quando o cliente republica sem ele', () => {
    const doCliente = {
      track: { id: 'local:1', title: 'Faixa editada' },
      remoteUrl: 'https://cofre/1',
    };
    const gravar = comCamposDoServidor(doCliente, noBanco);
    expect(gravar.dna).toEqual(vetor);
    // E a edição do cliente vale: preservar não é ignorar quem escreveu.
    expect((gravar.track as Record<string, unknown>).title).toBe('Faixa editada');
  });

  it('respeita o dna que veio preenchido — a curadoria escreve por aqui', () => {
    const novo = Array.from({ length: 8 }, (_, i) => i);
    const gravar = comCamposDoServidor({ track: { id: 'local:1' }, dna: novo }, noBanco);
    expect(gravar.dna).toEqual(novo);
  });

  it('faixa nova (sem anterior) passa intacta', () => {
    const nova = { track: { id: 'local:9' } };
    expect(comCamposDoServidor(nova, null)).toBe(nova);
  });
});

describe('enxugar a faixa para a listagem', () => {
  const cheia = () => ({
    track: {
      id: 't1',
      title: 'Uma',
      coverUrl: 'http://capa',
      durationMs: 1000,
      explicit: false,
      uploadedByUserId: null,
      dominantColor: null,
      trackNumber: 1,
      discNumber: 1,
      loudnessLufs: null,
      downloadUrl: null,
      releaseYear: null,
      playsCount: 0,
      album: { id: 'a1', title: 'Disco', slug: 'disco', coverUrl: 'http://capa' },
      artists: [{ id: 'x1', name: 'Djavan', slug: 'djavan', imageUrl: null }],
    },
    remoteUrl: 'http://cofre/1',
  });

  it('tira o peso morto e mantém o que a tela usa', () => {
    const saida = semCamposDoServidor(cheia()) as Objeto;
    const t = em(saida, 'track');
    // O que a lista precisa continua lá.
    expect(t).toMatchObject({ id: 't1', title: 'Uma', coverUrl: 'http://capa', durationMs: 1000 });
    expect(em(t, 'album').title).toBe('Disco');
    expect(em(t, 'artists', 0).name).toBe('Djavan');
    // O que ninguém lê, some.
    for (const morto of ['explicit', 'dominantColor', 'trackNumber', 'playsCount', 'downloadUrl']) {
      expect(morto in t).toBe(false);
    }
    expect('id' in em(t, 'album')).toBe(false);
    expect('coverUrl' in em(t, 'album')).toBe(false);
    expect('id' in em(t, 'artists', 0)).toBe(false);
    expect('imageUrl' in em(t, 'artists', 0)).toBe(false);
  });

  it('não copia a FAIXA à toa quando não há o que tirar dela', () => {
    // O acervo fica em cache na memória: copiar 5 mil objetos de faixa sem
    // necessidade seria o oposto do que este enxugamento busca. A entrada em si
    // é sempre recriada porque ganha o `tocavel`, que é calculado.
    const track = { id: 't', title: 'x', artists: [{ name: 'A' }] };
    const saida = semCamposDoServidor({ track }) as Objeto;
    expect(saida.track).toBe(track);
  });

  it('a listagem não leva mais o endereço de onde sai o som', () => {
    // Eram ~1,5 MB e 25 mil propriedades descendo para todo aparelho, para que
    // se usassem algumas dezenas por sessão. Agora vêm em GET /catalogo/:id.
    const saida = semCamposDoServidor({
      track: { id: 't', title: 'x', streamUrl: 'http://cofre/t' },
      remoteUrl: 'http://cofre/t',
      sourceUrl: 'https://youtu.be/x',
      contentHash: 'abc',
      mimeType: 'audio/mpeg',
      sizeBytes: 999,
    }) as Objeto;
    for (const f of ['remoteUrl', 'sourceUrl', 'contentHash', 'mimeType', 'sizeBytes']) {
      expect(f in saida).toBe(false);
    }
    expect('streamUrl' in em(saida, 'track')).toBe(false);
  });

  it('mas leva o BIT que diz se a faixa toca — senão o acervo sumiria da tela', () => {
    // O app esconde entrada sem cópia. Sem `tocavel`, tirar as URLs faria toda
    // entrada parecer quebrada e o acervo inteiro desapareceria.
    const comCopia = semCamposDoServidor({
      track: { id: 't', title: 'x' },
      remoteUrl: 'http://cofre/t',
    }) as Objeto;
    expect(comCopia.tocavel).toBe(true);

    const soStream = semCamposDoServidor({
      track: { id: 't', title: 'x', streamUrl: 'http://cofre/t' },
    }) as Objeto;
    expect(soStream.tocavel).toBe(true);

    const semNada = semCamposDoServidor({ track: { id: 't', title: 'x' } }) as Objeto;
    expect(semNada.tocavel).toBe(false);
  });

  it('o conteúdo sob demanda também sobrevive à republicação', () => {
    const anterior = {
      track: { id: 't', title: 'x', streamUrl: 'http://cofre/t' },
      remoteUrl: 'http://cofre/t',
      sourceUrl: 'https://youtu.be/x',
    };
    const doCliente = semCamposDoServidor(anterior);
    const gravar = comCamposDoServidor(doCliente, anterior) as Objeto;
    expect(gravar.remoteUrl).toBe('http://cofre/t');
    expect(gravar.sourceUrl).toBe('https://youtu.be/x');
    expect(em(gravar, 'track').streamUrl).toBe('http://cofre/t');
  });

  it('o `tocavel` NUNCA é gravado — é estado calculado, não dado', () => {
    // Gravado, ele envelheceria sozinho e passaria a mentir na primeira poda.
    const gravar = comCamposDoServidor(
      { track: { id: 't', title: 'x' }, tocavel: true },
      null,
    ) as Objeto;
    expect('tocavel' in gravar).toBe(false);
  });

  it('SOBREVIVE À REPUBLICAÇÃO — o que sai da listagem fica no banco', () => {
    // Sem isto, o primeiro aparelho que republicasse a faixa apagaria os
    // campos do banco para sempre. Economia viraria perda.
    const anterior = cheia();
    const doCliente = semCamposDoServidor(cheia()) as Objeto;
    const gravar = comCamposDoServidor(doCliente, anterior) as Objeto;
    expect(em(gravar, 'track').explicit).toBe(false);
    expect(em(gravar, 'track', 'album').id).toBe('a1');
    expect(em(gravar, 'track', 'album').coverUrl).toBe('http://capa');
    expect(em(gravar, 'track', 'artists', 0).id).toBe('x1');
  });

  it('respeita o valor que o cliente MANDOU preenchido', () => {
    const anterior = cheia();
    const doCliente = { track: { id: 't1', title: 'Uma', trackNumber: 7, artists: [] } };
    const gravar = comCamposDoServidor(doCliente, anterior) as Objeto;
    expect(em(gravar, 'track').trackNumber).toBe(7);
  });

  it('crédito alterado NÃO herda o id do artista antigo', () => {
    // Devolver o id errado seria pior que perder o id: vira metadata falsa,
    // que ninguém percebe.
    const anterior = cheia();
    const doCliente = { track: { id: 't1', title: 'Uma', artists: [{ name: 'Outro Artista' }] } };
    const gravar = comCamposDoServidor(doCliente, anterior) as Objeto;
    expect('id' in em(gravar, 'track', 'artists', 0)).toBe(false);
  });

  it('lista de artistas de outro tamanho não tenta casar por posição', () => {
    const anterior = cheia();
    const doCliente = {
      track: { id: 't1', title: 'Uma', artists: [{ name: 'Djavan' }, { name: 'Convidado' }] },
    };
    const gravar = comCamposDoServidor(doCliente, anterior) as Objeto;
    expect('id' in em(gravar, 'track', 'artists', 0)).toBe(false);
  });
});
