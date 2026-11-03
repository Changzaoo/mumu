// Testes do escolhedor de candidatos — a prova mínima que impede a busca
// livre (NetEase) de trocar a letra por uma de OUTRA música. Roda com o test
// runner nativo do Node (sem dependência nova): `node --test
// apps/importer/outrasFontesDeLetra.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  casaCandidato,
  extrairLetraDaPagina,
  separarArtistas,
  tentarGenius,
} from './outrasFontesDeLetra.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const buscaGeniusFixture = JSON.parse(
  readFileSync(path.join(HERE, '__fixtures__', 'genius-search.json'), 'utf8'),
);
const paginaGeniusFixture = readFileSync(
  path.join(HERE, '__fixtures__', 'genius-song.html'),
  'utf8',
);

const candidato = (over = {}) => ({
  titulo: 'Warzone',
  artistas: ['Brandão85'],
  duracaoSeg: 166,
  ...over,
});
const pedido = (over = {}) => ({
  titulo: 'Warzone',
  artista: 'Brandão85',
  duracaoSeg: 166,
  ...over,
});

test('artista e duração batendo: aceita', () => {
  assert.equal(casaCandidato(candidato(), pedido()), true);
});

test('título com variação (feat., remix): ainda casa', () => {
  assert.equal(casaCandidato(candidato({ titulo: 'Warzone (feat. Xamã)' }), pedido()), true);
  assert.equal(casaCandidato(candidato({ titulo: 'Warzone - Ao Vivo' }), pedido()), true);
});

test('sem artista e sem duração batendo: recusa — título sozinho não é prova', () => {
  assert.equal(
    casaCandidato(
      candidato({ artistas: [], duracaoSeg: null }),
      pedido({ artista: '', duracaoSeg: 0 }),
    ),
    false,
  );
});

test('artista bate mesmo sem duração conhecida do candidato', () => {
  assert.equal(casaCandidato(candidato({ duracaoSeg: null }), pedido()), true);
});

test('duração bate mesmo sem artista conhecido do candidato', () => {
  assert.equal(casaCandidato(candidato({ artistas: [] }), pedido()), true);
});

test('artista conhecido e DIFERENTE: recusa mesmo com duração batendo', () => {
  assert.equal(casaCandidato(candidato({ artistas: ['Charlie Brown Jr.'] }), pedido()), false);
});

test('duração longe demais (>5s): recusa — outra gravação da mesma música', () => {
  assert.equal(casaCandidato(candidato({ duracaoSeg: 200 }), pedido()), false);
});

test('duração a 5s de diferença: ainda aceita (tolerância da borda)', () => {
  assert.equal(casaCandidato(candidato({ duracaoSeg: 171 }), pedido()), true);
});

test('título diferente: recusa antes de qualquer outra coisa', () => {
  assert.equal(casaCandidato(candidato({ titulo: 'Só Os Loucos' }), pedido()), false);
});

test('dupla com conectivo ("e"/"and") ainda casa', () => {
  assert.equal(
    casaCandidato(
      candidato({ artistas: ['Chitãozinho e Xororó'] }),
      pedido({ artista: 'Chitaozinho and Xororo' }),
    ),
    true,
  );
});

test('acento e caixa não separam a mesma faixa', () => {
  assert.equal(
    casaCandidato(candidato({ artistas: ['BRANDAO85'] }), pedido({ artista: 'brandão85' })),
    true,
  );
});

// ── Genius: raspagem da página (fixture real, sem rede) ────────────────────

test('extrairLetraDaPagina: tira o cabeçalho da música e preserva os versos', () => {
  const texto = extrairLetraDaPagina(paginaGeniusFixture);
  assert.ok(texto);
  // Nada do cromado (título, colaboradores, prévia da bio) sobrevive.
  assert.ok(!texto.includes('Contributors'));
  assert.ok(!texto.includes('Mantém Lyrics'));
  assert.ok(!texto.includes('Read More'));
  // Os versos de verdade continuam lá, na ordem — inclusive o marcado com <a>
  // (anotação do Genius): a TAG some, a PALAVRA fica.
  assert.ok(texto.includes('Eu tô de volta com a mente de um chefe'));
  assert.ok(texto.includes('[Refrão]'));
  assert.ok(texto.includes('Vem mais, mais vem'));
  assert.ok(texto.includes('Me traz mais cem'));
});

test('extrairLetraDaPagina: página sem bloco de letra devolve null', () => {
  assert.equal(extrairLetraDaPagina('<html><body>sem letra aqui</body></html>'), null);
});

test('separarArtistas: conectivos comuns (com espaço) viram nomes separados', () => {
  assert.deepEqual(separarArtistas('WIU & Matuê'), ['WIU', 'Matuê']);
  assert.deepEqual(separarArtistas('Djonga feat. Rincon Sapiência'), [
    'Djonga',
    'Rincon Sapiência',
  ]);
  assert.deepEqual(separarArtistas('Chitãozinho e Xororó'), ['Chitãozinho', 'Xororó']);
});

test('tentarGenius: só aceita o resultado cujo artista bate, e raspa a letra dele', async () => {
  const original = globalThis.fetch;
  const caminhosPedidos = [];
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/api/search/song')) return new Response(JSON.stringify(buscaGeniusFixture));
    caminhosPedidos.push(s);
    return new Response(paginaGeniusFixture);
  };
  try {
    const r = await tentarGenius({ titulo: 'Mantém', artista: 'Matuê', duracaoSeg: 0 });
    assert.equal(r?.fonte, 'genius');
    assert.equal(r?.synced, false);
    assert.ok(r?.plain.includes('Eu tô de volta'));
    // O segundo resultado da busca (artista sem nenhuma relação) nem chegou a
    // ser raspado — a prova mínima descartou antes de gastar a requisição.
    assert.ok(!caminhosPedidos.some((u) => u.includes('Ninguem-conhecido')));
  } finally {
    globalThis.fetch = original;
  }
});

test('tentarGenius: artista não bate em nenhum resultado — recusa tudo, nunca raspa', async () => {
  const original = globalThis.fetch;
  let raspou = false;
  globalThis.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/api/search/song')) return new Response(JSON.stringify(buscaGeniusFixture));
    raspou = true;
    return new Response(paginaGeniusFixture);
  };
  try {
    const r = await tentarGenius({
      titulo: 'Mantém',
      artista: 'Artista Bem Diferente',
      duracaoSeg: 0,
    });
    assert.equal(r, null);
    assert.equal(raspou, false);
  } finally {
    globalThis.fetch = original;
  }
});

// ── auditoria 03/11/2026 (5.2): letra alheia com duração 0 e lyrics.ovh às cegas ──
import { tentarLyricsOvh } from './outrasFontesDeLetra.mjs';

const TABELA = [
  // [nome, candidato, pedido, esperado]
  ['"Amor" não casa com "Amora"', { titulo: 'Amora', artistas: ['MC X'], duracaoSeg: null }, { titulo: 'Amor', artista: 'MC X', duracaoSeg: 0 }, false],
  ['"Eu" não casa com "Medo"', { titulo: 'Eu', artistas: ['Ana'], duracaoSeg: 180 }, { titulo: 'Medo', artista: 'Ana', duracaoSeg: 180 }, false],
  ['"Ana" não é "Mariana"', { titulo: 'Warzone', artistas: ['Mariana Souza'], duracaoSeg: null }, { titulo: 'Warzone', artista: 'Ana', duracaoSeg: 0 }, false],
  ['"MC" sozinho não prova', { titulo: 'Warzone', artistas: ['MC'], duracaoSeg: null }, { titulo: 'Warzone', artista: 'MC Kevin', duracaoSeg: 0 }, false],
  ['duração 0: Pt. 1 não serve para Pt. 2', { titulo: 'Vida Loka, Pt. 1', artistas: ["Racionais MC's"], duracaoSeg: null }, { titulo: 'Vida Loka, Pt. 2', artista: "Racionais MC's", duracaoSeg: 0 }, false],
  ['duração 0: título só contido não basta', { titulo: 'Vida Loka', artistas: ["Racionais MC's"], duracaoSeg: null }, { titulo: 'Vida Loka, Pt. 2', artista: "Racionais MC's", duracaoSeg: 0 }, false],
  ['duração 0: título igual + artista', { titulo: 'Vida Loka, Pt. 2', artistas: ["Racionais MC's"], duracaoSeg: null }, { titulo: 'Vida Loka, Pt. 2', artista: "Racionais MC's", duracaoSeg: 0 }, true],
  ['duração confirma o título frouxo', { titulo: 'Warzone Pt 2', artistas: ['Brandão85'], duracaoSeg: 166 }, { titulo: 'Warzone', artista: 'Brandão85', duracaoSeg: 166 }, true],
  ['dupla com & e com e', { titulo: 'Evidências', artistas: ['Chitãozinho & Xororó'], duracaoSeg: null }, { titulo: 'Evidências', artista: 'Chitaozinho e Xororo', duracaoSeg: 0 }, true],
  ['acento e caixa', { titulo: 'CORAÇÃO', artistas: ['LUDMILLA'], duracaoSeg: 200 }, { titulo: 'coracao', artista: 'Ludmilla', duracaoSeg: 202 }, true],
  ['coreano igual', { titulo: '사랑해', artistas: ['아이유'], duracaoSeg: 200 }, { titulo: '사랑해', artista: '아이유', duracaoSeg: 200 }, true],
  ['duração a 6 s recusa', { titulo: 'Warzone', artistas: ['Brandão85'], duracaoSeg: 172 }, { titulo: 'Warzone', artista: 'Brandão85', duracaoSeg: 166 }, false],
  ['duração negativa conta como desconhecida', { titulo: 'Warzone', artistas: ['Brandão85'], duracaoSeg: -1 }, { titulo: 'Warzone', artista: 'Brandão85', duracaoSeg: 166 }, true],
];
for (const [nome, cand, ped, esperado] of TABELA) {
  test(`casaCandidato: ${nome}`, () => {
    assert.equal(casaCandidato(cand, ped), esperado);
  });
}

/** fetch dublado: rota → resposta; guarda as URLs pedidas. */
function dublarFetch(rotas) {
  const pedidas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    pedidas.push(u);
    const rota = Object.keys(rotas).find((r) => u.includes(r));
    if (!rota) return new Response('', { status: 404 });
    const r = rotas[rota];
    return new Response(JSON.stringify(r.corpo ?? null), { status: r.status ?? 200 });
  };
  return { pedidas, restaurar: () => (globalThis.fetch = original) };
}

test('lyrics.ovh: confere a identidade pelo /suggest e pede com o nome canônico', async () => {
  const f = dublarFetch({
    '/suggest/': {
      corpo: {
        data: [
          { title: 'Amora', artist: { name: 'MC X' }, duration: 200 },
          { title: 'Amor', artist: { name: 'Outro' }, duration: 200 },
          { title: 'Amor', artist: { name: 'MC X' }, duration: 201 },
        ],
      },
    },
    '/v1/': { corpo: { lyrics: 'é o amor\nque mexe' } },
  });
  try {
    const r = await tentarLyricsOvh({ titulo: 'amor', artista: 'mc x', duracaoSeg: 200 });
    assert.deepEqual(r, { synced: false, plain: 'é o amor\nque mexe', fonte: 'lyrics.ovh' });
    assert.ok(f.pedidas.some((u) => u.endsWith('/v1/MC%20X/Amor')));
  } finally {
    f.restaurar();
  }
});

for (const [nome, sugestoes] of [
  ['nenhuma sugestão', []],
  ['só outro artista', [{ title: 'Amor', artist: { name: 'Outro' }, duration: 200 }]],
  ['duração longe', [{ title: 'Amor', artist: { name: 'MC X' }, duration: 260 }]],
  ['título só parecido', [{ title: 'Amora', artist: { name: 'MC X' }, duration: 200 }]],
]) {
  test(`lyrics.ovh: ${nome} → nem pede a letra`, async () => {
    const f = dublarFetch({
      '/suggest/': { corpo: { data: sugestoes } },
      '/v1/': { corpo: { lyrics: 'letra de outra música' } },
    });
    try {
      assert.equal(await tentarLyricsOvh({ titulo: 'Amor', artista: 'MC X', duracaoSeg: 200 }), null);
      assert.ok(!f.pedidas.some((u) => u.includes('/v1/')));
    } finally {
      f.restaurar();
    }
  });
}

test('lyrics.ovh: sem artista nem tenta', async () => {
  const f = dublarFetch({});
  try {
    assert.equal(await tentarLyricsOvh({ titulo: 'Amor', artista: '', duracaoSeg: 200 }), null);
    assert.equal(f.pedidas.length, 0);
  } finally {
    f.restaurar();
  }
});
