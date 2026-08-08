/**
 * GRAVAR O GÊNERO NÃO PODE APAGAR A FAIXA.
 *
 * As passagens de curadoria falam a sintaxe do Firestore: `{'track.genre': 'Trap'}`
 * significa "mude SÓ este campo". Lá isso era nativo. No Postgres o `data` é uma
 * coluna JSON e um `update` substitui o documento INTEIRO — então quem traduz é
 * o `aplicarPatch`.
 *
 * Se ele estiver errado, o estrago é máximo e silencioso: corrigir o gênero de
 * uma faixa apagaria título, artistas, capa e duração dela junto, em milhares de
 * faixas, sem erro nenhum no log. É o teste mais importante da migração.
 */
import { describe, expect, it } from 'vitest';
import { aplicarPatch } from './curation.worker.js';

const faixa = {
  track: {
    id: 'local:1',
    title: 'BENÇA',
    genre: 'Sertanejo',
    artists: [{ id: 'a1', name: 'Matuê' }],
    coverUrl: 'https://x/capa.jpg',
    durationMs: 180000,
  },
  addedAt: '2026-07-14T00:00:00.000Z',
  sizeBytes: 5037202,
};

describe('aplicarPatch — caminho pontilhado sobre JSON', () => {
  it('muda só o gênero e PRESERVA o resto da faixa', () => {
    const saida = aplicarPatch(faixa, { 'track.genre': 'Trap' });

    expect(saida.track?.genre).toBe('Trap');
    // O estrago que este teste existe para impedir:
    expect(saida.track?.title).toBe('BENÇA');
    expect(saida.track?.artists).toEqual([{ id: 'a1', name: 'Matuê' }]);
    expect(saida.track?.coverUrl).toBe('https://x/capa.jpg');
    expect(saida.track?.durationMs).toBe(180000);
    expect(saida.addedAt).toBe('2026-07-14T00:00:00.000Z');
    // `sizeBytes` não está no tipo — e é exatamente o ponto: campos que a
    // curadoria não conhece têm que atravessar a gravação intactos.
    expect((saida as Record<string, unknown>).sizeBytes).toBe(5037202);
  });

  it('grava campo de primeiro nível sem tocar em track', () => {
    const saida = aplicarPatch(faixa, { curatedAt: 1786000000000 });

    expect(saida.curatedAt).toBe(1786000000000);
    expect(saida.track?.title).toBe('BENÇA');
  });

  it('aceita vários caminhos de uma vez', () => {
    const saida = aplicarPatch(faixa, {
      'track.genre': 'Trap',
      'track.title': 'BENÇA (Remaster)',
      curatedAt: 1,
    });

    expect(saida.track?.genre).toBe('Trap');
    expect(saida.track?.title).toBe('BENÇA (Remaster)');
    expect(saida.curatedAt).toBe(1);
    expect(saida.track?.artists).toHaveLength(1);
  });

  it('grava null (é assim que o balde "Brasileira" é esvaziado)', () => {
    const saida = aplicarPatch(
      { track: { genre: 'Brasileira', title: 'X' } },
      {
        'track.genre': null,
      },
    );

    expect(saida.track?.genre).toBeNull();
    expect(saida.track?.title).toBe('X');
  });

  it('NÃO muta a entrada original', () => {
    const original = structuredClone(faixa);
    aplicarPatch(faixa, { 'track.genre': 'Trap' });

    // A varredura reusa o objeto entre passagens; mutar aqui faria uma passagem
    // enxergar o resultado da outra e decidir com dado que ainda não foi gravado.
    expect(faixa).toEqual(original);
  });

  it('cria o nível intermediário quando ele não existe', () => {
    const saida = aplicarPatch({}, { 'track.genre': 'Trap' });
    expect(saida.track?.genre).toBe('Trap');
  });

  it('não confunde array com objeto ao descer o caminho', () => {
    const saida = aplicarPatch(faixa, { 'track.artists': [{ id: 'a2', name: 'Teto' }] });
    expect(saida.track?.artists).toEqual([{ id: 'a2', name: 'Teto' }]);
    expect(saida.track?.title).toBe('BENÇA');
  });

  it('grava o vetor de DNA sem estragar a faixa', () => {
    const vetor = Array.from({ length: 8 }, (_, i) => i / 10);
    const saida = aplicarPatch(faixa, { dna: vetor });

    expect(saida.dna).toEqual(vetor);
    expect(saida.track?.title).toBe('BENÇA');
  });
});

/**
 * OS CAMINHOS VÊM DE CÓDIGO LEGADO, e `split('.')` aceita qualquer coisa.
 *
 * Nenhum destes casos aparece hoje nas passagens de curadoria — todas escrevem
 * caminhos literais de dois níveis. O que estes testes travam é o silêncio: até
 * aqui, um caminho torto NÃO dava erro. Ele gravava — no lugar errado, ou por
 * cima de uma lista — e devolvia sucesso. Numa varredura 24/7 que roda sobre a
 * biblioteca inteira sem ninguém olhando, "grava errado e diz que deu certo" é a
 * única falha que não tem como ser percebida a tempo.
 *
 * A regra nova é: caminho que não dá para honrar não grava NADA e estoura. Todo
 * `doc.ref.update` da curadoria já está dentro de um `try` que registra a falha e
 * segue para a próxima faixa — então a entrada fica como estava, com rastro.
 */
describe('aplicarPatch — caminhos tortos não gravam em silêncio', () => {
  it('ARRAY no meio do caminho: recusa em vez de transformar a lista em mapa', () => {
    // O estrago concreto: `artists: [{name:'Matuê'}]` viraria `{"0":{...}}`.
    // Todo o sistema testa `Array.isArray(track.artists)` antes de ler, então a
    // faixa passaria a não ter artista nenhum — sumiria da prateleira do artista
    // e perderia o voto de gênero, sem uma linha de log.
    expect(() => aplicarPatch(faixa, { 'track.artists.0.name': 'Teto' })).toThrow(/lista/);
  });

  it('e a entrada original sai INTACTA da recusa', () => {
    const original = structuredClone(faixa);
    expect(() => aplicarPatch(faixa, { 'track.artists.0.name': 'Teto' })).toThrow();
    expect(faixa).toEqual(original);
  });

  it('chave vazia: recusa em vez de criar uma chave "" na raiz', () => {
    expect(() => aplicarPatch(faixa, { '': 'x' })).toThrow(/malformado/);
    expect(() => aplicarPatch(faixa, { '.genre': 'x' })).toThrow(/malformado/);
    expect(() => aplicarPatch(faixa, { 'track.': 'x' })).toThrow(/malformado/);
    expect(() => aplicarPatch(faixa, { 'track..genre': 'x' })).toThrow(/malformado/);
  });

  it('`__proto__` no caminho: recusa em vez de perder o patch calado', () => {
    // Sem isso: `alvo['__proto__'] = {...}` cai no acessor, o dado NÃO entra no
    // documento (o `JSON` gravado sai sem ele), o objeto sai com o protótipo
    // trocado, e o `update` responde sucesso.
    expect(() => aplicarPatch(faixa, { '__proto__.x': 1 })).toThrow(/proibido/);
    expect(() => aplicarPatch(faixa, { 'constructor.prototype.x': 1 })).toThrow(/proibido/);
    expect(() => aplicarPatch(faixa, { 'track.prototype.x': 1 })).toThrow(/proibido/);
  });

  it('escalar no meio VIRA mapa — é assim que o nível intermediário nasce', () => {
    // Continua valendo, e é o comportamento que o Firestore tinha: sem ele,
    // `{'track.genre': 'Trap'}` numa entrada sem `track` não teria onde gravar.
    expect(aplicarPatch({}, { 'track.genre': 'Trap' }).track?.genre).toBe('Trap');
    expect(aplicarPatch({ track: null } as never, { 'track.genre': 'Trap' }).track?.genre).toBe(
      'Trap',
    );
    const deString = aplicarPatch({ track: 'só o título' } as never, { 'track.genre': 'Trap' });
    expect(deString.track?.genre).toBe('Trap');
  });

  it('os caminhos que a curadoria REALMENTE escreve continuam passando', () => {
    // A lista completa do worker — se algum deles passar a estourar, a curadoria
    // inteira para de gravar e este teste é quem avisa.
    const saida = aplicarPatch(faixa, {
      curatedAt: 1,
      generoAuditadoEm: 2,
      dna: [0.1],
      duplicatasFundidas: ['outra'],
      'track.artists': [{ name: 'Teto' }],
      'track.title': 'X',
      'track.genre': 'Trap',
      'track.label': 'MK',
    });
    expect(saida.track?.genre).toBe('Trap');
    expect(saida.track?.artists).toEqual([{ name: 'Teto' }]);
    expect(saida.track?.label).toBe('MK');
    expect(saida.curatedAt).toBe(1);
  });
});
