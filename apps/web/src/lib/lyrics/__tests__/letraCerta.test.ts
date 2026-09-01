/**
 * A LETRA TEM QUE SER DESSA MÚSICA — falta de prova é reprovação.
 *
 * O casamento de título contra o LRCLIB é de propósito frouxo: "Warzone" precisa
 * casar com "Warzone (Remix)" e com "warzone". Frouxo assim, ele NUNCA pode
 * bastar sozinho — e bastava: quando a faixa não tinha artista conhecido (o
 * crédito "Desconhecido" é descartado antes da busca) e a linha do LRCLIB vinha
 * sem duração, a ausência dos dois dados contava como aprovação. Entrava a letra
 * de outra música, ia para o cache e ficava.
 *
 * A regra travada aqui: além do título, ou o ARTISTA bate, ou a DURAÇÃO bate.
 */
import { describe, expect, it } from 'vitest';
import { rowMatches, type LrclibRow } from '@/lib/lyrics/lyrics';

const linha = (r: Partial<LrclibRow>): LrclibRow => ({
  trackName: 'Warzone',
  artistName: 'Brandão85',
  duration: 166,
  ...r,
});

describe('a linha do LRCLIB é mesmo desta faixa?', () => {
  it('artista e duração batendo: aceita', () => {
    expect(rowMatches(linha({}), 'Warzone', ['Brandão85'], 166)).toBe(true);
  });

  it('título frouxo casa com a variação da mesma faixa', () => {
    expect(rowMatches(linha({ trackName: 'Warzone (Remix)' }), 'Warzone', ['Brandão85'], 166)).toBe(
      true,
    );
  });

  // ── O DEFEITO ────────────────────────────────────────────────────────────
  it('sem artista E sem duração, recusa — era aqui que entrava letra alheia', () => {
    const anonima = linha({ artistName: null, duration: null });
    expect(rowMatches(anonima, 'Warzone', [], 0)).toBe(false);
  });

  it('faixa sem artista conhecido ainda entra SE a duração provar', () => {
    // A prova mudou de dono, mas continua existindo.
    expect(rowMatches(linha({ artistName: null }), 'Warzone', [], 166)).toBe(true);
  });

  it('linha sem duração ainda entra SE o artista provar', () => {
    expect(rowMatches(linha({ duration: null }), 'Warzone', ['Brandão85'], 166)).toBe(true);
  });

  // ── o que já era recusado continua sendo ────────────────────────────────
  it('artista conhecido e diferente: recusa', () => {
    expect(
      rowMatches(linha({ artistName: 'Charlie Brown Jr.' }), 'Warzone', ['Brandão85'], 166),
    ).toBe(false);
  });

  it('duração longe demais: recusa (outra gravação da mesma música)', () => {
    expect(rowMatches(linha({ duration: 240 }), 'Warzone', ['Brandão85'], 166)).toBe(false);
  });

  it('título diferente: recusa antes de qualquer outra coisa', () => {
    expect(rowMatches(linha({ trackName: 'Só Os Loucos' }), 'Warzone', ['Brandão85'], 166)).toBe(
      false,
    );
  });

  it('acento e caixa não separam a mesma faixa', () => {
    expect(rowMatches(linha({ artistName: 'BRANDAO85' }), 'warzone', ['Brandão85'], 166)).toBe(
      true,
    );
  });
});

/**
 * TODA MÚSICA QUE NÃO SE ESCREVE EM a-z FICAVA SEM LETRA.
 *
 * A normalização de comparação apagava tudo que não fosse `[a-z0-9]`. Para
 * português isso é só tirar acento — mas para um título inteiro em coreano,
 * japonês, chinês, russo, grego, árabe, hebraico ou tailandês o resultado é a
 * STRING VAZIA, e a primeira linha de `rowMatches` recusa vazio.
 *
 * O efeito é cruel porque é invisível: o LRCLIB ENCONTRAVA a letra certa e
 * devolvia a linha correta — era o nosso próprio guarda que a jogava fora.
 * Nenhum erro, nenhum log: a faixa só ficava para sempre sem letra.
 *
 * Estes testes cobrem os DOIS lados, e o segundo grupo importa tanto quanto o
 * primeiro: a saída fácil (deixar passar quando a normalização esvazia) traria
 * de volta exatamente o defeito que este arquivo existe para impedir — letra de
 * outra música entrando por falta de prova.
 */
describe('letra em qualquer idioma, não só o que cabe em a-z', () => {
  it('coreano: título e artista em hangul, duração batendo', () => {
    const row = { trackName: '소리꾼', artistName: '스트레이 키즈', duration: 187 };
    expect(rowMatches(row, '소리꾼', ['스트레이 키즈'], 187)).toBe(true);
  });

  it('japonês: título em kana/kanji', () => {
    const row = { trackName: '打上花火', artistName: 'DAOKO', duration: 275 };
    expect(rowMatches(row, '打上花火', ['DAOKO'], 275)).toBe(true);
  });

  it('russo: cirílico', () => {
    const row = { trackName: 'Кукушка', artistName: 'Кино', duration: 226 };
    expect(rowMatches(row, 'Кукушка', ['Кино'], 226)).toBe(true);
  });

  it('misto: título coreano com artista em latim (o caso do K-pop no acervo)', () => {
    const row = { trackName: '소리꾼', artistName: 'Stray Kids', duration: 187 };
    expect(rowMatches(row, '소리꾼', ['Stray Kids'], 187)).toBe(true);
  });

  it('grego, árabe e tailandês também são idiomas', () => {
    expect(rowMatches({ trackName: 'Ελλάδα', duration: 200 }, 'Ελλάδα', [], 200)).toBe(true);
    expect(rowMatches({ trackName: 'قلبي', duration: 200 }, 'قلبي', [], 200)).toBe(true);
    expect(rowMatches({ trackName: 'ลาก่อน', duration: 200 }, 'ลาก่อน', [], 200)).toBe(true);
  });

  // ── O CONSERTO NÃO PODE VIRAR UM "ACEITA TUDO" ──────────────────────────
  it('dois títulos coreanos DIFERENTES continuam sendo recusados', () => {
    // Se a correção apenas deixasse passar quando a normalização esvazia, esta
    // linha entraria — e seria a letra de outra música, em cache, para sempre.
    const row = { trackName: '소리꾼', artistName: '스트레이 키즈', duration: 187 };
    expect(rowMatches(row, '별거 아니야', ['스트레이 키즈'], 187)).toBe(false);
  });

  it('coreano com artista conhecido e diferente: recusa', () => {
    const row = { trackName: '소리꾼', artistName: '방탄소년단', duration: 187 };
    expect(rowMatches(row, '소리꾼', ['스트레이 키즈'], 187)).toBe(false);
  });

  it('coreano sem artista E sem duração: recusa, como em qualquer idioma', () => {
    const row = { trackName: '소리꾼', artistName: null, duration: null };
    expect(rowMatches(row, '소리꾼', [], 0)).toBe(false);
  });

  it('título vazio de verdade continua recusado', () => {
    // A pontuação sozinha não é nome de faixa; isto tem de continuar caindo.
    expect(rowMatches({ trackName: '---', duration: 200 }, '...', [], 200)).toBe(false);
  });
});
