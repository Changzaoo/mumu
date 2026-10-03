import { describe, expect, it } from 'vitest';
import { corrigirGrafia, ehLetraEmPortugues, normalizarLetra } from '@/lib/lyrics/grafia';
import { toLyrics, type Lyrics } from '@/lib/lyrics/lyrics';

/** Letra clara em português: o dicionário só roda com esta prova de idioma. */
const PT = ['não tem pobrema pra você', 'isso é tudo meu'];

function letra(textos: string[], extra: Partial<Lyrics> = {}): Lyrics {
  return {
    synced: true,
    source: null,
    lines: textos.map((text, i) => ({ timeMs: i * 1000, text })),
    ...extra,
  };
}

describe('corrigirGrafia: o que corrige', () => {
  it.each([
    ['nóis é assim', 'nós é assim'], // só a grafia, a concordância fica
    ['nois vai', 'nós vai'],
    ['o mermo de sempre', 'o mesmo de sempre'],
    ['sem pobrema', 'sem problema'],
    ['a muié chegou', 'a mulher chegou'],
    ['ocê sabe', 'você sabe'],
    ['tamém quero', 'também quero'],
    ['vou prantar', 'vou plantar'],
    ['bicicreta nova', 'bicicleta nova'],
    ['framengo', 'flamengo'],
    ['vamo embora', 'vamos embora'],
    ['vou fazê o corre', 'vou fazer o corre'],
    ['quero pegá', 'quero pegar'],
    ['voce nao sabe', 'você não sabe'],
    ['ta bom', 'tá bom'],
  ])('%s -> %s', (entrada, saida) => {
    expect(corrigirGrafia(entrada)).toBe(saida);
  });
});

describe('corrigirGrafia: o que NÃO muda', () => {
  it.each([
    'tá tô pra pro né cê', // contrações dicionarizadas
    'mano, parça, novinha', // gíria é palavra, não erro
    'os cara chegou', // concordância
    'meu fio chegou', // "fio" é ambíguo
    'num sei', // "num" é ambíguo (não / em um)
    'o bebê no rolê', // palavras reais que terminam em ê
    'ele veio cedo', // verbo vir
    'fazê-lo e pegá-la', // forma composta correta, com hífen
    "d'ocê",
    '[Refrão: Nois]', // cabeçalho de seção
    'Mermão chegou', // gíria dicionarizada
  ])('%s fica igual', (texto) => {
    expect(corrigirGrafia(texto)).toBe(texto);
  });

  it('é idempotente', () => {
    const uma = corrigirGrafia('nóis tamém, ocê vai fazê');
    expect(corrigirGrafia(uma)).toBe(uma);
  });
});

describe('corrigirGrafia: caixa e pontuação', () => {
  it('mantém maiúscula inicial e CAIXA ALTA', () => {
    expect(corrigirGrafia('Nóis, Mermo')).toBe('Nós, Mesmo');
    expect(corrigirGrafia('NÓIS MERMO')).toBe('NÓS MESMO');
    expect(corrigirGrafia('Voce')).toBe('Você');
  });

  it('mantém a pontuação colada e o espaçamento', () => {
    expect(corrigirGrafia('(nóis),  mermo... tamém!')).toBe('(nós),  mesmo... também!');
  });

  it('nunca muda a quantidade de palavras', () => {
    const entrada = 'nóis vamo fazê o mermo, ocê tamém nao ta sabendo';
    const saida = corrigirGrafia(entrada);
    expect(saida.split(/\s+/)).toHaveLength(entrada.split(/\s+/).length);
  });
});

describe('ehLetraEmPortugues', () => {
  it('reconhece português', () => {
    expect(ehLetraEmPortugues(PT)).toBe(true);
    expect(ehLetraEmPortugues(['coração', 'canção', 'não vou'])).toBe(true);
  });

  it('não reconhece inglês nem espanhol', () => {
    expect(ehLetraEmPortugues(['I got the memo', 'ta ta ta', 'you know the fia'])).toBe(false);
    expect(ehLetraEmPortugues(['no puedo vivir sin ti', 'te quiero mucho', 'mi corazón'])).toBe(
      false,
    );
  });
});

describe('normalizarLetra', () => {
  it('só roda em letra portuguesa (inglês com "memo"/"ta" fica intacto)', () => {
    const ingles = letra(['read the memo', 'ta da', 'we are the fia']);
    expect(normalizarLetra(ingles)).toBe(ingles);
  });

  it('preserva linhas, tempos, campos extras e a contagem de palavras', () => {
    const entrada = letra([
      'nóis tá aqui, não tem pobrema',
      'ocê tamém vai fazê',
      'isso é tudo meu',
    ]);
    (entrada as Lyrics & { alinhada: boolean }).alinhada = true;
    const saida = normalizarLetra(entrada);
    expect(saida.lines.map((l) => l.text)).toEqual([
      'nós tá aqui, não tem problema',
      'você também vai fazer',
      'isso é tudo meu',
    ]);
    expect(saida.lines.map((l) => l.timeMs)).toEqual(entrada.lines.map((l) => l.timeMs));
    expect((saida as Lyrics & { alinhada?: boolean }).alinhada).toBe(true);
    saida.lines.forEach((l, i) => {
      expect(l.text.split(/\s+/)).toHaveLength(
        (entrada.lines[i] as { text: string }).text.split(/\s+/).length,
      );
    });
    // O original não é mutado: o cache e o alinhamento continuam com o texto cru.
    expect(entrada.lines[0]?.text).toBe('nóis tá aqui, não tem pobrema');
  });

  it('corrige o texto das palavras com tempo e mantém os tempos (LRC estendido)', () => {
    const l = toLyrics({
      syncedLyrics:
        '[00:01.00]<00:01.00>nóis <00:01.40>não <00:01.80>tem <00:02.20>pobrema <00:02.60>pra <00:03.00>você',
    });
    const saida = normalizarLetra(l);
    const linha = saida?.lines[0];
    expect(linha?.text).toBe('nós não tem problema pra você');
    expect(linha?.words?.map((w) => w.text)).toEqual([
      'nós',
      'não',
      'tem',
      'problema',
      'pra',
      'você',
    ]);
    expect(linha?.words?.map((w) => w.timeMs)).toEqual([1000, 1400, 1800, 2200, 2600, 3000]);
  });

  it('devolve o mesmo objeto quando não há o que corrigir', () => {
    const limpa = letra(['não tem problema pra você', 'isso é tudo meu']);
    expect(normalizarLetra(limpa)).toBe(limpa);
    expect(normalizarLetra(null)).toBeNull();
  });
});
