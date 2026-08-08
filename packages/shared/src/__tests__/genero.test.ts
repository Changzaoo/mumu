/**
 * CATEGORIA ERRADA É PIOR QUE CATEGORIA NENHUMA.
 *
 * O classificador de gênero tinha dois defeitos que se somavam:
 *
 *  1. O prompt não dava saída. Mandava escolher UM gênero da lista, ponto — o
 *     modelo era obrigado a chutar diante de qualquer faixa que não conhecesse,
 *     que é o caso da maior parte do acervo (artista independente).
 *  2. O parser garimpava qualquer nome da taxonomia em QUALQUER lugar do texto.
 *     Com um modelo de raciocínio, que escreve o pensamento antes de concluir,
 *     isso lia o rascunho como decisão — e transformava uma RECUSA do modelo
 *     ("não conheço, talvez seja pop") numa categoria.
 *
 * O palpite não ficava escondido: virava a prateleira de gênero, o mix e a
 * recomendação. Estes testes travam a regra nova — na dúvida, `null`.
 */
import { describe, expect, it } from 'vitest';
import {
  GENRE_TAXONOMY,
  genreMessages,
  parseGenre,
  parseVerify,
  verifyGenreMessages,
} from '../ai/curation';
import { batchGenreMessages, parseBatchGenres } from '../ai/agents';
import { revisarGeneros } from '../ai/generoCoerencia';

describe('classificação de gênero', () => {
  it('o prompt oferece DESCONHECIDO e proíbe deduzir pelo título', () => {
    const sistema = genreMessages('WARZONE', 'Brandão85')[0]?.content ?? '';
    expect(sistema).toContain('DESCONHECIDO');
    expect(sistema).toContain('clima do título');
  });

  it('resposta limpa vira gênero', () => {
    expect(parseGenre('Trap')).toBe('Trap');
    expect(parseGenre('  MPB  ')).toBe('MPB');
  });

  it('aceita a conclusão depois do raciocínio — é a ÚLTIMA linha que vale', () => {
    expect(parseGenre('A faixa tem base de 808 e flow cantado.\nTrap')).toBe('Trap');
    expect(parseGenre('Gênero: Rock')).toBe('Rock');
    expect(parseGenre('**Pagode**')).toBe('Pagode');
  });

  // ── O DEFEITO ────────────────────────────────────────────────────────────
  it('recusa do modelo NÃO vira categoria', () => {
    expect(parseGenre('Não conheço essa música, talvez seja Pop')).toBeNull();
    expect(parseGenre('DESCONHECIDO')).toBeNull();
    expect(parseGenre('Desconhecido')).toBeNull();
  });

  it('negação no meio do raciocínio não é atribuição', () => {
    // Antes: achava "Rock" na frase e creditava Rock à faixa.
    expect(parseGenre('Isso definitivamente não é Rock.')).toBeNull();
  });

  it('texto sem conclusão vira null, e a faixa fica sem categoria', () => {
    expect(parseGenre('Preciso de mais contexto para responder.')).toBeNull();
    expect(parseGenre('')).toBeNull();
  });

  it('inventar categoria fora da taxonomia não passa', () => {
    expect(parseGenre('Brega Funk')).toBeNull();
  });

  // ── tolerância que não afrouxa a regra ──────────────────────────────────
  it('pontuação e acento do rótulo não derrubam uma resposta boa', () => {
    expect(parseGenre('Hip Hop/Rap')).toBe('Hip-Hop/Rap');
    expect(parseGenre('eletronica')).toBe('Eletrônica');
    expect(parseGenre('"R&B/Soul".')).toBe('R&B/Soul');
  });

  it('todo rótulo da taxonomia é reconhecido por ele mesmo', () => {
    for (const g of GENRE_TAXONOMY) expect(parseGenre(g)).toBe(g);
  });

  // ── o glossário, que é o que separava os rótulos que colidiam ────────────
  it('o prompt define os rótulos que se confundiam', () => {
    const sistema = genreMessages('WARZONE', 'Brandão85')[0]?.content ?? '';
    expect(sistema).toContain('funk carioca'); // não é o funk americano
    expect(sistema).toContain('NUNCA Lo-Fi'); // trap com vocal não é Lo-Fi
    expect(sistema).toContain('NÃO use para faixa com 808'); // nem sertanejo
  });

  it('o caminho em LOTE do servidor carrega o mesmo glossário', () => {
    // Sem isto, o worker reintroduziria de madrugada o que o app corrigiu.
    const lote = batchGenreMessages([{ title: 'WARZONE', artist: 'Brandão85' }])[0]?.content ?? '';
    expect(lote).toContain('funk carioca');
    expect(lote).toContain('NUNCA Lo-Fi');
    expect(lote).toContain('NÃO CONHECER');
  });

  it('o lote também normaliza — e o balde não passa', () => {
    expect(parseBatchGenres('["Funk brasileiro","Brasileira","Trap"]', 3)).toEqual([
      'Funk',
      null,
      'Trap',
    ]);
  });
});

describe('auditoria de categoria (a pergunta que faltava)', () => {
  // A curadoria só sabia PREENCHER gênero vazio. Faixa já categorizada, ainda
  // que errada, nunca mais era olhada — o trap ficava no sertanejo para sempre.

  it('pergunta pela categoria da faixa, com as definições junto', () => {
    const msgs = verifyGenreMessages('WARZONE', 'Brandão85', 'Sertanejo');
    expect(msgs[0]?.content).toContain('funk carioca'); // glossário presente
    expect(msgs[0]?.content).toContain('INCERTO');
    expect(msgs[1]?.content).toContain('WARZONE');
    expect(msgs[1]?.content).toContain('Sertanejo');
  });

  it('só o NAO autoriza mexer — SIM e INCERTO deixam como está', () => {
    expect(parseVerify('NAO')).toBe(false); // único que reclassifica
    expect(parseVerify('SIM')).toBe(true);
    expect(parseVerify('INCERTO')).toBeNull();
  });

  // ── "NÃO SEI" NÃO É "NÃO" ───────────────────────────────────────────────
  // Em português a dúvida começa com a mesma palavra da negação, e o parser
  // lia qualquer "nao" solto como acusação. Como `false` é o ÚNICO veredito
  // que autoriza escrever por cima, era justamente quando o modelo admitia
  // ignorância que o sistema entendia "corrija" — e reescrevia metadata certa
  // com um palpite. Valia para o auditor de CATEGORIA e para o de ARTISTA.
  it('hesitação do modelo vira incerteza, nunca acusação', () => {
    expect(parseVerify('não sei dizer')).toBeNull();
    expect(parseVerify('Não conheço essa música.')).toBeNull();
    expect(parseVerify('não tenho certeza')).toBeNull();
    expect(parseVerify('Não dá para afirmar com segurança.')).toBeNull();
  });

  it('uma negação de verdade continua sendo negação', () => {
    expect(parseVerify('NAO, essa música é de outro artista')).toBe(false);
    expect(parseVerify('Analisando o caso… NAO')).toBe(false);
    // Hesita e depois conclui: vale a conclusão.
    expect(parseVerify('Não tenho certeza, mas... NAO')).toBe(false);
  });
});

/**
 * "RARIDADE", DO ANDERSON FREIRE, FICOU EM SERTANEJO — e a regra do outlier
 * nunca ia salvá-la.
 *
 * Ela exige 3 votos e 75% do artista, números feitos para discografia grande e
 * certos no caso comum: um artista de pop PODE ter uma faixa de rock, então
 * mexer precisa de prova forte.
 *
 * Gospel não funciona assim. Cantor de louvor não tem uma faixa sertaneja no
 * meio do repertório — o gênero é propriedade DELE. E como a batida do gospel
 * brasileiro imita sertanejo, forró e trap, a fonte erra sempre na mesma
 * direção, enquanto o modelo, que não conhece a faixa, responde "incerto" e
 * deixa como está.
 */
describe('revisarGeneros — gênero que é do artista', () => {
  const f = (id: string, genre: string | null, artista: string) => ({
    id,
    genre,
    artistas: [artista],
  });

  it('puxa a faixa que destoa com apenas DUAS faixas do artista', () => {
    // O caso exato do banco: 2 Gospel + 1 Sertanejo do Anderson Freire.
    const mudancas = revisarGeneros([
      f('1', 'Gospel', 'Anderson Freire'),
      f('2', 'Gospel', 'Anderson Freire'),
      f('3', 'Sertanejo', 'Anderson Freire'),
    ]);
    const raridade = mudancas.find((m) => m.id === '3');
    expect(raridade?.para).toBe('Gospel');
    expect(raridade?.motivo).toBe('genero-do-artista');
  });

  it('NÃO faz o mesmo com gêneros que variam faixa a faixa', () => {
    // Pop e Rock são escolha por faixa: dois votos não podem arrastar o resto.
    const mudancas = revisarGeneros([
      f('1', 'Pop', 'Fulano'),
      f('2', 'Pop', 'Fulano'),
      f('3', 'Rock', 'Fulano'),
    ]);
    expect(mudancas.find((m) => m.id === '3')).toBeUndefined();
  });

  it('não age com um voto só', () => {
    const mudancas = revisarGeneros([f('1', 'Gospel', 'Fulano'), f('2', 'Sertanejo', 'Fulano')]);
    expect(mudancas.find((m) => m.id === '2')).toBeUndefined();
  });

  it('não mexe em quem já está no lugar', () => {
    const mudancas = revisarGeneros([
      f('1', 'Gospel', 'Aline Barros'),
      f('2', 'Gospel', 'Aline Barros'),
      f('3', 'Gospel', 'Aline Barros'),
    ]);
    expect(mudancas).toHaveLength(0);
  });

  it('também preenche faixa SEM categoria do mesmo artista', () => {
    const mudancas = revisarGeneros([
      f('1', 'Gospel', 'Gabriela Rocha'),
      f('2', 'Gospel', 'Gabriela Rocha'),
      f('3', null, 'Gabriela Rocha'),
    ]);
    expect(mudancas.find((m) => m.id === '3')?.para).toBe('Gospel');
  });
});
