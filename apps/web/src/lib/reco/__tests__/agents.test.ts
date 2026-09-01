/**
 * O time de recomendação. Cada agente responde uma pergunta diferente, e o
 * teste aqui é sobre a pergunta: o agente do relógio não pode responder o que o
 * do calendário responderia, e nenhum deles pode devolver prateleira com o que
 * a pessoa acabou de ouvir.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@radinho/shared';
import {
  agenteDasLetras,
  agenteDeSingles,
  agenteDoCalendario,
  agenteDoRelogio,
  construirPrateleirasDeAgentes,
  ehSingle,
  faixaDoDia,
  semelhancaDeTemas,
  temasDaLetra,
  type AgenteInputs,
} from '@/lib/reco/agents';

function faixa(id: string, over: Partial<TrackDto> = {}): TrackDto {
  return {
    id,
    title: over.title ?? `Faixa ${id}`,
    artists: over.artists ?? [{ id: `a:${id}`, name: `Artista ${id}`, slug: id, imageUrl: null }],
    album: over.album ?? null,
    coverUrl: null,
    durationMs: 180_000,
    ...over,
  } as TrackDto;
}

/** Play em data/hora exatas — o recorte dos agentes é sobre isto. */
function play(track: TrackDto, iso: string): { playedAt: string; track: TrackDto } {
  return { playedAt: iso, track };
}

const VAZIO: AgenteInputs = { entries: [], history: [], liked: [], now: new Date() };

describe('faixaDoDia', () => {
  it('separa o dia em blocos que uma pessoa reconhece', () => {
    expect(faixaDoDia(3).key).toBe('madrugada');
    expect(faixaDoDia(9).key).toBe('manha');
    expect(faixaDoDia(15).key).toBe('tarde');
    expect(faixaDoDia(21).key).toBe('noite');
  });
});

describe('agenteDoRelogio', () => {
  // Segundas de manhã (2026-08-03 é uma segunda).
  const manhaUtil = ['2026-08-03T08:10:00', '2026-07-27T08:20:00', '2026-07-20T07:40:00'];
  // Domingos de manhã.
  const manhaFds = ['2026-08-02T08:15:00', '2026-07-26T09:00:00'];

  it('não inventa prateleira sem sinal suficiente', () => {
    const t = faixa('1');
    const inputs = { ...VAZIO, history: [play(t, manhaUtil[0]!)], now: new Date(manhaUtil[0]!) };
    expect(agenteDoRelogio(inputs)).toBeNull();
  });

  it('separa a manhã de dia útil da manhã de fim de semana', () => {
    const trabalho = [faixa('w1'), faixa('w2'), faixa('w3'), faixa('w4')];
    const folga = [faixa('f1'), faixa('f2'), faixa('f3'), faixa('f4')];
    const history = [
      ...manhaUtil.flatMap((d) => trabalho.map((t) => play(t, d))),
      ...manhaFds.flatMap((d) => folga.map((t) => play(t, d))),
    ];

    // Segunda de manhã: só as de trabalho.
    const util = agenteDoRelogio({ ...VAZIO, history, now: new Date('2026-08-03T08:30:00') });
    expect(util).not.toBeNull();
    expect(util!.tracks.map((t) => t.id).sort()).toEqual(['w1', 'w2', 'w3', 'w4']);

    // Domingo de manhã: só as de folga. É o recorte cruzado funcionando —
    // mesma HORA, resposta diferente.
    const fds = agenteDoRelogio({ ...VAZIO, history, now: new Date('2026-08-02T08:30:00') });
    expect(fds).not.toBeNull();
    expect(fds!.tracks.map((t) => t.id).sort()).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('ignora plays de outra faixa do dia', () => {
    const manha = [faixa('m1'), faixa('m2'), faixa('m3'), faixa('m4')];
    const noite = faixa('n1');
    const history = [
      ...manhaUtil.flatMap((d) => manha.map((t) => play(t, d))),
      ...Array.from({ length: 20 }, () => play(noite, '2026-08-03T23:00:00')),
    ];
    const shelf = agenteDoRelogio({ ...VAZIO, history, now: new Date('2026-08-03T09:00:00') });
    expect(shelf!.tracks.some((t) => t.id === 'n1')).toBe(false);
  });
});

describe('agenteDoCalendario', () => {
  it('só traz o que é CARACTERÍSTICO do tipo de dia', () => {
    const soFds = faixa('fds');
    const todoDia = faixa('sempre');
    const outras = [faixa('x1'), faixa('x2'), faixa('x3')];
    const history = [
      // Fim de semana: as exclusivas + a de sempre
      ...Array.from({ length: 4 }, () => play(soFds, '2026-08-02T14:00:00')),
      ...outras.flatMap((t) => [play(t, '2026-08-02T15:00:00'), play(t, '2026-08-01T15:00:00')]),
      play(todoDia, '2026-08-02T16:00:00'),
      // Dias úteis: a de sempre, muito mais
      ...Array.from({ length: 10 }, () => play(todoDia, '2026-08-03T10:00:00')),
    ];
    const shelf = agenteDoCalendario({ ...VAZIO, history, now: new Date('2026-08-02T18:00:00') });
    expect(shelf).not.toBeNull();
    expect(shelf!.tracks.some((t) => t.id === 'fds')).toBe(true);
    // A que ele ouve todo dia não diz nada sobre o fim de semana.
    expect(shelf!.tracks.some((t) => t.id === 'sempre')).toBe(false);
  });
});

describe('ehSingle', () => {
  const semAlbum = (): number => 0;

  it('faixa sem álbum é single', () => {
    expect(ehSingle(faixa('1'), semAlbum)).toBe(true);
  });

  it('álbum com o mesmo nome da música é single disfarçado', () => {
    const t = faixa('1', { title: 'Evidências', album: { id: 'x', title: 'Evidências' } as never });
    expect(ehSingle(t, semAlbum)).toBe(true);
  });

  it('álbum de verdade (2+ faixas) não é single', () => {
    const t = faixa('1', { title: 'Faixa 1', album: { id: 'x', title: 'Dos Prédio' } as never });
    expect(ehSingle(t, () => 12)).toBe(false);
  });
});

describe('agenteDeSingles', () => {
  it('não devolve o que a pessoa acabou de ouvir', () => {
    const artista = [{ id: 'a', name: 'Matuê', slug: 'matue', imageUrl: null }];
    const ouvida = faixa('ouvida', { artists: artista });
    const novas = ['n1', 'n2', 'n3', 'n4'].map((id) => faixa(id, { artists: artista }));
    const inputs: AgenteInputs = {
      ...VAZIO,
      entries: [ouvida, ...novas].map((track) => ({ track, addedAt: '2026-07-01T00:00:00' })),
      history: [play(ouvida, '2026-08-03T10:00:00')],
    };
    const shelf = agenteDeSingles(inputs);
    expect(shelf).not.toBeNull();
    expect(shelf!.tracks.some((t) => t.id === 'ouvida')).toBe(false);
    expect(shelf!.tracks).toHaveLength(4);
  });

  it('sem artista afim não sugere nada em vez de sugerir qualquer coisa', () => {
    const inputs: AgenteInputs = {
      ...VAZIO,
      entries: ['a', 'b', 'c', 'd'].map((id) => ({
        track: faixa(id),
        addedAt: '2026-07-01T00:00:00',
      })),
    };
    expect(agenteDeSingles(inputs)).toBeNull();
  });
});

describe('temas das letras', () => {
  it('descarta palavra funcional — senão tudo parece com tudo', () => {
    const temas = temasDaLetra('que você não vai saudade');
    expect(temas.has('que')).toBe(false);
    expect(temas.has('voce')).toBe(false);
    expect(temas.has('saudade')).toBe(true);
  });

  it('ignora acento para casar a mesma palavra escrita de dois jeitos', () => {
    expect(temasDaLetra('saudade').has('saudade')).toBe(true);
    expect(temasDaLetra('SAUDADE').has('saudade')).toBe(true);
  });

  it('semelhança é 0 quando um dos lados está vazio', () => {
    expect(semelhancaDeTemas(new Map(), temasDaLetra('saudade coração'))).toBe(0);
  });

  it('semelhança cresce com vocabulário em comum', () => {
    const a = temasDaLetra('saudade coração estrada viagem');
    const iguais = temasDaLetra('saudade coração estrada viagem');
    const nada = temasDaLetra('dinheiro carro corrente ouro');
    expect(semelhancaDeTemas(a, iguais)).toBeGreaterThan(semelhancaDeTemas(a, nada));
  });
});

describe('agenteDasLetras', () => {
  it('acha faixa que FALA do mesmo assunto, de outro artista', () => {
    const ref = ['r1', 'r2', 'r3'].map((id) => faixa(id));
    // Quatro candidatas do mesmo assunto: prateleira com menos que isso não é
    // prateleira, e o agente recusa montar — por isso a fixture precisa de 4.
    const parecidas = ['parecida', 'p2', 'p3', 'p4'].map((id) =>
      faixa(id, { artists: [{ id: 'z', name: 'Outro Artista', slug: 'z', imageUrl: null }] }),
    );
    const distantes = ['d1', 'd2', 'd3'].map((id) => faixa(id));

    // Letra de verdade tem dezenas de palavras distintas — o agente exige esse
    // lastro antes de traçar um perfil, então a fixture precisa ser realista.
    const ESTRADA =
      'saudade estrada coração viagem poeira caminho janela paisagem distância volta ' +
      'partida cidade sertão chuva horizonte cansaço lembrança casa espera silêncio';
    const DINHEIRO =
      'dinheiro corrente ouro carro pista grife garrafa champanhe iate mansão relógio ' +
      'diamante camarote festa luxo poder holofote fama iate coroa';

    const letras: Record<string, string> = {
      r1: ESTRADA,
      r2: ESTRADA,
      r3: ESTRADA,
      // A mais próxima: todo o vocabulário dela está no perfil.
      parecida: 'saudade estrada coração viagem poeira caminho janela lembrança volta espera',
      p2: 'saudade estrada janela chuva cidade lembrança pista carro festa noite',
      p3: 'saudade caminho volta espera cidade chuva ouro relógio festa camarote',
      p4: 'estrada viagem horizonte poeira sertão cansaço champanhe iate grife luxo',
      d1: DINHEIRO,
      d2: DINHEIRO,
      d3: DINHEIRO,
    };

    const inputs: AgenteInputs = {
      ...VAZIO,
      entries: [...parecidas, ...distantes].map((track) => ({
        track,
        addedAt: '2026-07-01T00:00:00',
      })),
      history: ref.map((t) => play(t, '2026-08-01T10:00:00')),
    };

    const shelf = agenteDasLetras(inputs, (id) => letras[id] ?? null);
    expect(shelf).not.toBeNull();
    // Ordenada por semelhança: a que só fala do assunto do perfil vem antes.
    expect(shelf!.tracks[0]!.id).toBe('parecida');
    // As de outro assunto ficam de fora, mesmo com a prateleira precisando
    // encher — completar com qualquer coisa é o que estraga recomendação.
    expect(shelf!.tracks.some((t) => t.id.startsWith('d'))).toBe(false);
  });

  it('sem letras conhecidas o bastante, não arrisca um perfil', () => {
    const inputs: AgenteInputs = {
      ...VAZIO,
      entries: [{ track: faixa('a'), addedAt: '2026-07-01T00:00:00' }],
      history: [play(faixa('r1'), '2026-08-01T10:00:00')],
    };
    expect(agenteDasLetras(inputs, () => 'saudade estrada')).toBeNull();
  });
});

describe('o time inteiro', () => {
  it('biblioteca vazia devolve nenhuma prateleira, não prateleiras vazias', () => {
    expect(construirPrateleirasDeAgentes(VAZIO, () => null)).toEqual([]);
  });

  it('cada prateleira tem chave única — é ela que a Home usa como key', () => {
    const artista = [{ id: 'a', name: 'X', slug: 'x', imageUrl: null }];
    const tracks = ['t1', 't2', 't3', 't4', 't5'].map((id) => faixa(id, { artists: artista }));
    const history = tracks.flatMap((t) => [
      play(t, '2026-08-03T08:00:00'),
      play(t, '2026-07-27T08:00:00'),
    ]);
    const inputs: AgenteInputs = {
      ...VAZIO,
      entries: tracks.map((track) => ({ track, addedAt: '2026-07-01T00:00:00' })),
      history,
      now: new Date('2026-08-03T08:30:00'),
    };
    const shelves = construirPrateleirasDeAgentes(inputs, () => null);
    const keys = shelves.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
