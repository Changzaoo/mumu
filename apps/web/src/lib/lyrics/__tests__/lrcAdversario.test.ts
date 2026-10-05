/**
 * LRC e linhas do LRCLIB em ENTRADA ADVERSÁRIA: o que o arquivo traz de
 * esquisito (BOM, CRLF, metadados, tempos fora de ordem, offset, palavra
 * incompleta) não pode virar linha errada, texto perdido nem exceção.
 */
import { describe, expect, it } from 'vitest';
import { toLyrics, rowMatches, type LrclibRow } from '@/lib/lyrics/lyrics';
import { lerPalavrasMarcadas, linhaAtiva, palavrasDaLinha } from '@/lib/lyrics/karaoke';

const tempos = (l: ReturnType<typeof toLyrics>): number[] => l?.lines.map((x) => x.timeMs) ?? [];
const textos = (l: ReturnType<typeof toLyrics>): string[] => l?.lines.map((x) => x.text) ?? [];

describe('parse de LRC: arquivo sujo', () => {
  it('BOM + CRLF + tags de metadados: só as linhas de letra sobram', () => {
    const lrc =
      '﻿[ar:Artista]\r\n[ti:Título]\r\n[al:Álbum]\r\n[by:alguém]\r\n[length:03:20]\r\n' +
      '[00:01.00]primeira\r\n[00:02.50]segunda\r\n';
    const l = toLyrics({ syncedLyrics: lrc });
    expect(textos(l)).toEqual(['primeira', 'segunda']);
    expect(tempos(l)).toEqual([1000, 2500]);
  });

  it('linha só com [00:00.00] no começo, com BOM colado', () => {
    const l = toLyrics({ syncedLyrics: '﻿[00:00.00]abre' });
    expect(tempos(l)).toEqual([0]);
    expect(textos(l)).toEqual(['abre']);
  });

  it('linhas vazias e sem timestamp são ignoradas; timestamp sem texto vira pausa ("")', () => {
    const l = toLyrics({ syncedLyrics: '\n\ncoisa solta\n[00:05.00]\n   \n[00:06.00]oi\n' });
    expect(textos(l)).toEqual(['', 'oi']);
    expect(tempos(l)).toEqual([5000, 6000]);
  });

  it('fora de ordem fica ordenado; tempos iguais mantêm a ordem do arquivo', () => {
    const l = toLyrics({
      syncedLyrics: '[00:10.00]c\n[00:05.00]a\n[00:05.00]b\n[00:05.00]b2\n[00:01.00]z',
    });
    expect(textos(l)).toEqual(['z', 'a', 'b', 'b2', 'c']);
  });

  it('vários tempos na mesma linha (refrão) repetem o texto em cada um', () => {
    const l = toLyrics({ syncedLyrics: '[00:10.00][00:50.00][01:30.00]refrão' });
    expect(tempos(l)).toEqual([10000, 50000, 90000]);
    expect(textos(l)).toEqual(['refrão', 'refrão', 'refrão']);
  });

  it('fração com 1, 2 e 3 dígitos e com dois-pontos', () => {
    const l = toLyrics({ syncedLyrics: '[00:01.5]a\n[00:02.05]b\n[00:03.123]c\n[00:04:50]d' });
    expect(tempos(l)).toEqual([1500, 2050, 3123, 4500]);
  });

  it('sem fração: segundos redondos', () => {
    expect(tempos(toLyrics({ syncedLyrics: '[01:02]x' }))).toEqual([62000]);
  });

  it('timestamp negativo ou malformado não casa e não derruba o resto', () => {
    const l = toLyrics({ syncedLyrics: '[-00:05.00]neg\n[0:5]curto\n[ab:cd]x\n[00:03.00]ok' });
    expect(textos(l)).toEqual(['ok']);
  });

  it('só metadados / lixo / nada: sem letra (null), sem lançar', () => {
    expect(toLyrics({ syncedLyrics: '[ar:X]\n[ti:Y]' })).toBeNull();
    expect(toLyrics({ syncedLyrics: 'lixo qualquer' })).toBeNull();
    expect(toLyrics({ syncedLyrics: '   ', plainLyrics: '  ' })).toBeNull();
    expect(toLyrics({})).toBeNull();
    expect(toLyrics(null)).toBeNull();
    expect(toLyrics(undefined)).toBeNull();
  });

  it('campo que não é texto (JSON malformado da fonte) não lança', () => {
    const row = { syncedLyrics: 123, plainLyrics: { a: 1 } } as unknown as LrclibRow;
    expect(toLyrics(row)).toBeNull();
  });

  it('synced só de metadados cai para o texto puro', () => {
    const l = toLyrics({ syncedLyrics: '[ar:X]', plainLyrics: 'a\nb' });
    expect(l?.synced).toBe(false);
    expect(textos(l)).toEqual(['a', 'b']);
  });

  it('letra de uma linha só', () => {
    const l = toLyrics({ syncedLyrics: '[00:01.00]única' });
    expect(l?.lines).toHaveLength(1);
    expect(linhaAtiva(l!.lines, 0)).toBe(-1);
    expect(linhaAtiva(l!.lines, 5000)).toBe(0);
  });

  it('letra enorme (5 mil linhas) é lida inteira e em ordem', () => {
    const lrc = Array.from({ length: 5_000 }, (_, i) => {
      const s = 5_000 - i; // de trás para frente, de propósito
      return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.00]l${s}`;
    }).join('\n');
    const t0 = Date.now();
    const l = toLyrics({ syncedLyrics: lrc });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(l?.lines).toHaveLength(5_000);
    const ts = tempos(l);
    expect(ts.every((v, i) => i === 0 || (ts[i - 1] as number) <= v)).toBe(true);
  });
});

describe('parse de LRC: [offset]', () => {
  it('offset positivo adianta; negativo atrasa', () => {
    expect(tempos(toLyrics({ syncedLyrics: '[offset:+500]\n[00:02.00]x' }))).toEqual([1500]);
    expect(tempos(toLyrics({ syncedLyrics: '[offset:-500]\n[00:02.00]x' }))).toEqual([2500]);
    expect(tempos(toLyrics({ syncedLyrics: '[offset: 500 ]\n[00:02.00]x' }))).toEqual([1500]);
  });

  it('offset maior que o tempo não gera tempo negativo', () => {
    expect(tempos(toLyrics({ syncedLyrics: '[offset:5000]\n[00:01.00]x' }))).toEqual([0]);
  });

  it('offset no fim do arquivo vale igual; caixa não importa', () => {
    expect(tempos(toLyrics({ syncedLyrics: '[00:02.00]x\n[Offset:+500]' }))).toEqual([1500]);
  });

  it('offset também desloca o tempo de cada palavra (LRC por palavra)', () => {
    const l = toLyrics({
      syncedLyrics: '[offset:+500]\n[00:02.00]<00:02.00>a <00:02.50>b',
    });
    expect(l?.lines[0]?.timeMs).toBe(1500);
    expect(l?.lines[0]?.words?.map((w) => w.timeMs)).toEqual([1500, 2000]);
  });

  it('offset ilegível (sem número) vale zero', () => {
    expect(tempos(toLyrics({ syncedLyrics: '[offset:abc]\n[00:02.00]x' }))).toEqual([2000]);
  });
});

describe('parse de LRC por palavra', () => {
  it('as palavras casam com o texto da linha, completas', () => {
    const l = toLyrics({ syncedLyrics: '[00:01.00]<00:01.00>Eu <00:01.50>vou <00:02.00>ali' });
    expect(l?.lines[0]?.text).toBe('Eu vou ali');
    expect(l?.lines[0]?.words?.map((w) => w.text)).toEqual(['Eu', 'vou', 'ali']);
  });

  it('LRC por palavra INCOMPLETO (texto antes da 1ª marca): nenhuma palavra some da tela', () => {
    // LyricsView desenha só `words` quando existe — palavra fora dele some da letra.
    const l = toLyrics({ syncedLyrics: '[00:01.00]Eu vou <00:02.00>ali' });
    const linha = l!.lines[0]!;
    expect(linha.text).toBe('Eu vou ali');
    const exibidas = (linha.words ?? palavrasDaLinha(linha, null)).map((w) => w.text);
    expect(exibidas).toEqual(['Eu', 'vou', 'ali']);
    // as do começo entram no instante da linha, a marcada no dela
    if (linha.words) expect(linha.words.map((w) => w.timeMs)).toEqual([1000, 1000, 2000]);
  });

  it('marca sem texto depois (fim da linha) não cria palavra vazia', () => {
    const l = toLyrics({ syncedLyrics: '[00:01.00]<00:01.00>fim <00:02.00>' });
    expect(l?.lines[0]?.words?.map((w) => w.text)).toEqual(['fim']);
    expect(l?.lines[0]?.text).toBe('fim');
  });

  it('linha com vários tempos descarta as palavras (marcas são absolutas)', () => {
    const l = toLyrics({ syncedLyrics: '[00:01.00][00:20.00]<00:01.00>a <00:01.50>b' });
    expect(l?.lines).toHaveLength(2);
    expect(l?.lines.every((x) => x.text === 'a b' && !x.words)).toBe(true);
  });

  it('lerPalavrasMarcadas sem marcas devolve só o texto aparado', () => {
    expect(lerPalavrasMarcadas('  oi  ', 0)).toEqual({ text: 'oi' });
  });
});

describe('preview de 30s (semTempo)', () => {
  it('tira marcas de tempo, de palavra, metadados e BOM; sem tempo nenhum', () => {
    const l = toLyrics(
      {
        syncedLyrics:
          '﻿[ar:X]\r\n[offset:+100]\r\n[00:01.00]<00:01.00>oi <00:01.50>tu\r\n[00:03.00]\r\n[00:04.00]tchau',
      },
      true,
    );
    expect(l?.synced).toBe(false);
    expect(textos(l)).toEqual(['oi tu', 'tchau']);
    expect(tempos(l)).toEqual([0, 0]);
  });

  it('com texto puro disponível, usa o texto puro (não o LRC)', () => {
    const l = toLyrics({ syncedLyrics: '[00:01.00]a', plainLyrics: 'texto puro' }, true);
    expect(textos(l)).toEqual(['texto puro']);
    expect(l?.synced).toBe(false);
  });

  it('LRC só de metadados no preview: sem letra', () => {
    expect(toLyrics({ syncedLyrics: '[ar:X]\n[00:01.00]' }, true)).toBeNull();
  });

  it('instrumental (sem texto) não vira letra', () => {
    expect(toLyrics({ instrumental: true, plainLyrics: '', syncedLyrics: '' }, true)).toBeNull();
    expect(toLyrics({ instrumental: true, plainLyrics: null, syncedLyrics: null })).toBeNull();
  });
});

describe('texto puro', () => {
  it('CRLF, espaços aparados, linhas em branco mantidas como separador', () => {
    const l = toLyrics({ plainLyrics: '  a  \r\n\r\nb\r\n' });
    expect(l?.synced).toBe(false);
    expect(textos(l)).toEqual(['a', '', 'b', '']);
    expect(tempos(l).every((t) => t === 0)).toBe(true);
  });
});

describe('índice ativo', () => {
  const linhas = [{ timeMs: 1000 }, { timeMs: 2000 }, { timeMs: 2000 }, { timeMs: 3000 }];

  it('antes da 1ª linha = -1; depois da última = última', () => {
    expect(linhaAtiva(linhas, 0)).toBe(-1);
    expect(linhaAtiva(linhas, 999)).toBe(-1);
    expect(linhaAtiva(linhas, 1_000_000)).toBe(3);
  });

  it('tempos iguais: vale a ÚLTIMA delas', () => {
    expect(linhaAtiva(linhas, 2000)).toBe(2);
    expect(linhaAtiva(linhas, 2999)).toBe(2);
  });

  it('lista vazia e posição inválida não lançam', () => {
    expect(linhaAtiva([], 5)).toBe(-1);
    expect(linhaAtiva(linhas, Number.NaN)).toBe(-1);
    expect(linhaAtiva(linhas, -50)).toBe(-1);
  });
});

describe('rowMatches: título, artista e duração adversários', () => {
  const linha = (r: Partial<LrclibRow>): LrclibRow => ({
    trackName: 'Lembrei de Tu',
    artistName: 'MC Meno K',
    duration: 173,
    ...r,
  });

  it('acento, caixa e emoji não atrapalham', () => {
    expect(
      rowMatches(linha({ trackName: 'VOCÊ NÃO SABE' }), 'Você Não Sabe 🔥', ['mc meno k'], 173),
    ).toBe(true);
  });

  it('"(feat.)" e "- Remastered" no título da faixa: ainda casa com o título limpo da linha', () => {
    expect(
      rowMatches(linha({}), 'Lembrei de Tu (feat. Fulano) - Remastered 2011', ['MC Meno K'], 173),
    ).toBe(true);
  });

  it('artistas múltiplos: qualquer um serve, em qualquer ordem', () => {
    const r = linha({ artistName: 'B & A' });
    expect(rowMatches(r, 'Lembrei de Tu', ['A', 'B'], 173)).toBe(true);
    expect(rowMatches(r, 'Lembrei de Tu', ['B', 'A'], 173)).toBe(true);
    expect(rowMatches(r, 'Lembrei de Tu', ['C', 'D'], 173)).toBe(false);
  });

  it('duração: 3 s de tolerância, 4 s recusa', () => {
    expect(rowMatches(linha({ duration: 176 }), 'Lembrei de Tu', ['MC Meno K'], 173)).toBe(true);
    expect(rowMatches(linha({ duration: 177 }), 'Lembrei de Tu', ['MC Meno K'], 173)).toBe(false);
  });

  it('duração da faixa 0 / NaN / negativa: não compara, o artista tem que provar', () => {
    for (const d of [0, Number.NaN, -10]) {
      expect(rowMatches(linha({ duration: 999 }), 'Lembrei de Tu', ['MC Meno K'], d)).toBe(true);
      expect(rowMatches(linha({ artistName: null }), 'Lembrei de Tu', [], d)).toBe(false);
    }
  });

  it('título CJK / sem alfabeto latino ainda casa', () => {
    expect(
      rowMatches(linha({ trackName: '사랑해', artistName: '아이유' }), '사랑해', ['아이유'], 173),
    ).toBe(true);
  });

  it('título só de emoji nunca casa (não há o que comparar)', () => {
    expect(rowMatches(linha({ trackName: '🔥🔥' }), '🔥🔥', ['MC Meno K'], 173)).toBe(false);
  });

  // ── letra errada é pior que letra ausente ────────────────────────────────
  it('título que só CONTÉM o da faixa no meio de outra palavra não casa ("Amor" x "Amora")', () => {
    // Preview de 30s não tem duração: só título + artista seguram a letra errada.
    expect(rowMatches(linha({ trackName: 'Amora' }), 'Amor', ['MC Meno K'], 0)).toBe(false);
    expect(rowMatches(linha({ trackName: 'Eu' }), 'Medo', ['MC Meno K'], 0)).toBe(false);
  });

  it('título contido como PALAVRA continua casando (variações da mesma faixa)', () => {
    expect(rowMatches(linha({ trackName: 'Amor (Ao Vivo)' }), 'Amor', ['MC Meno K'], 0)).toBe(true);
    expect(rowMatches(linha({ trackName: 'Amor' }), 'Amor - Ao Vivo', ['MC Meno K'], 0)).toBe(true);
  });

  it('artista que só CONTÉM o nome dentro de outra palavra não prova nada', () => {
    expect(rowMatches(linha({ artistName: 'Mariana Souza' }), 'Lembrei de Tu', ['Ana'], 0)).toBe(
      false,
    );
    expect(rowMatches(linha({ artistName: 'MC Kevinho' }), 'Lembrei de Tu', ['MC Kevin'], 0)).toBe(
      false,
    );
  });
});
