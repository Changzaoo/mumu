/**
 * Só a letra: o que o provedor escreve entre colchetes não é cantado e não
 * aparece — nem vai para o alinhamento. Caso real: "Mundo Fashion" (Tz da
 * Coronel ft. Matuê), letra de texto puro vinda do Genius, 27/10/2026.
 */
import { describe, expect, it } from 'vitest';
import { ehCabecalho, semCabecalhos, semRotuloDeSecao } from '@/lib/lyrics/cabecalhos';
import { linhasParaAlinhar } from '@/lib/lyrics/recalibrar';
import { toLyrics, type Lyrics } from '@/lib/lyrics/lyrics';

const MUNDO_FASHION = [
  '[Letra de "Mundo Fashion" ft. Matuê]',
  '[Intro: Tz da Coronel]',
  "Tz da Coro', hahaha (Nagalli, he sent me the magic)",
  'Yeah, yeah, yeah',
  '[Refrão: Tz da Coronel]',
  'Baby, eu entro no seu mundo fashion (Oh, yeah)',
  'Flawless brilham bem mais que um VVS (Oh)',
  '',
  '[Pós-Refrão: Tz da Coronel]',
  'O valor de X na minha corrente não é ostentação',
  '',
  '[Verso 1: Matuê]',
  'Cortes na minha jeans, eu sou fashion (Fashion, fashion)',
  '[Refrão: Tz da Coronel & Matuê]',
  'Baby, eu entro no seu mundo fashion (Como ela é sexy)',
  '[Saída: Matuê]',
  'Olha meu molho, yeah',
];

describe('ehCabecalho: a linha inteira é metadado do provedor', () => {
  it.each([
    '[Letra de "Mundo Fashion" ft. Matuê]',
    '[Intro: Tz da Coronel]',
    '[Refrão: Tz da Coronel & Matuê]',
    '[Pré-Refrão]',
    '[Verso 2: Tz da Coronel]',
    '[Ponte]',
    '[Outro]',
    '[Saída: Matuê]',
    '[Chorus: Travis Scott]',
    '[Verse 1]',
    '[Bridge] [Mano Brown]',
    '  [x2]  ',
    '[Instrumental]',
  ])('%s é cabeçalho', (linha) => {
    expect(ehCabecalho(linha)).toBe(true);
  });

  it.each([
    'Baby, eu entro no seu mundo fashion (Oh, yeah)',
    'Isso tem haver comigo, jogando a vibração',
    '[Refrão] Eu vou ali e volto', // rótulo colado num verso: o verso fica
    'eu disse [sic] que ia',
    '',
    '♪',
  ])('%j NÃO é cabeçalho', (linha) => {
    expect(ehCabecalho(linha)).toBe(false);
  });
});

describe('semRotuloDeSecao: rótulo colado no começo do verso', () => {
  it('tira "[Refrão]" e "[Verso 1: Matuê]" do começo e deixa o verso', () => {
    expect(semRotuloDeSecao('[Refrão] Eu vou ali e volto')).toBe('Eu vou ali e volto');
    expect(semRotuloDeSecao('[Verso 1: Matuê] Cortes na minha jeans')).toBe(
      'Cortes na minha jeans',
    );
    expect(semRotuloDeSecao('[Chorus: Both]Baby')).toBe('Baby');
  });

  it('colchete que não é nome de seção fica (pode ser texto)', () => {
    expect(semRotuloDeSecao('[Ela] disse que vinha')).toBe('[Ela] disse que vinha');
    expect(semRotuloDeSecao('eu disse [sic] que ia')).toBe('eu disse [sic] que ia');
  });
});

describe('semCabecalhos: só a letra vai para a tela', () => {
  const plana: Lyrics = {
    synced: false,
    source: null,
    lines: MUNDO_FASHION.map((text) => ({ timeMs: 0, text })),
  };

  it('remove toda linha de cabeçalho do "Mundo Fashion" e nenhuma cantada', () => {
    const limpa = semCabecalhos(plana);
    const textos = limpa.lines.map((l) => l.text);
    expect(textos.some((t) => t.startsWith('['))).toBe(false);
    expect(textos).toEqual([
      "Tz da Coro', hahaha (Nagalli, he sent me the magic)",
      'Yeah, yeah, yeah',
      'Baby, eu entro no seu mundo fashion (Oh, yeah)',
      'Flawless brilham bem mais que um VVS (Oh)',
      '',
      'O valor de X na minha corrente não é ostentação',
      '',
      'Cortes na minha jeans, eu sou fashion (Fashion, fashion)',
      'Baby, eu entro no seu mundo fashion (Como ela é sexy)',
      'Olha meu molho, yeah',
    ]);
  });

  it('o branco que era só o rastro do cabeçalho sai; os outros ficam (são pausa, "♪")', () => {
    const l = semCabecalhos({
      synced: false,
      source: null,
      lines: ['', '[Intro]', '', 'a', '', '[Refrão]', '', 'b', '[Outro]', '', 'c', ''].map(
        (text) => ({ timeMs: 0, text }),
      ),
    });
    expect(l.lines.map((x) => x.text)).toEqual(['', 'a', '', 'b', '', 'c', '']);
  });

  it('letra sincronizada sem cabeçalho: toda linha em branco (pausa) continua lá', () => {
    const l: Lyrics = {
      synced: true,
      source: null,
      lines: [
        { timeMs: 0, text: '' },
        { timeMs: 5000, text: 'a' },
        { timeMs: 9000, text: '' },
        { timeMs: 20000, text: 'b' },
      ],
    };
    expect(semCabecalhos(l)).toBe(l);
  });

  it('letra sem cabeçalho volta o MESMO objeto (nada re-renderiza à toa)', () => {
    const limpa: Lyrics = {
      synced: true,
      source: null,
      lines: [
        { timeMs: 1000, text: 'a' },
        { timeMs: 2000, text: 'b' },
      ],
    };
    expect(semCabecalhos(limpa)).toBe(limpa);
    expect(semCabecalhos(null)).toBeNull();
  });

  it('letra sincronizada: mantém tempo, `words`, e os extras do objeto', () => {
    const alinhada = {
      synced: true,
      source: null,
      alinhada: true,
      lines: [
        { timeMs: 0, text: '[Intro: Tz da Coronel]' },
        { timeMs: 7820, text: 'Yeah, yeah, yeah', words: [{ text: 'Yeah,', timeMs: 7820 }] },
        {
          timeMs: 9000,
          text: '[Refrão] Baby, eu entro',
          words: [
            { text: '[Refrão]', timeMs: 9000 },
            { text: 'Baby,', timeMs: 9100 },
            { text: 'eu', timeMs: 9400 },
            { text: 'entro', timeMs: 9600 },
          ],
        },
      ],
    };
    const l = semCabecalhos(alinhada);
    expect(l.alinhada).toBe(true);
    expect(l.lines).toEqual([
      { timeMs: 7820, text: 'Yeah, yeah, yeah', words: [{ text: 'Yeah,', timeMs: 7820 }] },
      {
        timeMs: 9000,
        text: 'Baby, eu entro',
        words: [
          { text: 'Baby,', timeMs: 9100 },
          { text: 'eu', timeMs: 9400 },
          { text: 'entro', timeMs: 9600 },
        ],
      },
    ]);
  });
});

describe('o cabeçalho sai ANTES de gravar e ANTES de alinhar', () => {
  it('toLyrics (texto puro do provedor) já devolve a letra limpa', () => {
    const l = toLyrics({ plainLyrics: MUNDO_FASHION.join('\n') });
    expect(l?.lines.map((x) => x.text).filter((t) => t.startsWith('['))).toEqual([]);
    expect(l?.lines[0]?.text).toBe("Tz da Coro', hahaha (Nagalli, he sent me the magic)");
  });

  it('toLyrics (LRC com cabeçalho cronometrado) também', () => {
    const l = toLyrics({
      syncedLyrics: '[00:00.10][Intro: Tz da Coronel]\n[00:07.82]Yeah, yeah, yeah',
    });
    expect(l?.lines).toEqual([{ timeMs: 7820, text: 'Yeah, yeah, yeah' }]);
  });

  it('linhasParaAlinhar nunca manda cabeçalho ao importador', () => {
    const letra: Lyrics = {
      synced: false,
      source: null,
      lines: ['[Intro]', 'a', '', '[Refrão: X]', 'b'].map((text) => ({ timeMs: 0, text })),
    };
    expect(linhasParaAlinhar(letra)).toEqual([1, 4]);
  });
});
