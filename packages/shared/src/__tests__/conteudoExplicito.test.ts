/**
 * O QUE ESTES TESTES PROTEGEM.
 *
 * Um classificador de palavrão por lista de palavras quase nunca falha por
 * deixar passar. Ele falha por ACUSAR ERRADO — e, neste app, o falso positivo
 * mais provável é justamente contra o repertório que o sistema existe para
 * proteger: hino gospel fala de sangue, de guerra e de morte o tempo todo.
 *
 * Por isso metade destes testes são de inocência, e eles vêm primeiro.
 */
import { describe, expect, it } from 'vitest';
import {
  classificarFaixa,
  classificarTexto,
  normalizarParaAnalise,
} from '../ai/conteudoExplicito.js';

describe('conteúdo explícito — não acusar inocente', () => {
  it('HINO GOSPEL não é violência: sangue, guerra e morte são o vocabulário dele', () => {
    // O erro que destruiria a confiança de quem mais depende deste filtro.
    const hino =
      'Pelo sangue de Jesus eu venci, na guerra espiritual não temerei a morte, ' +
      'porque Ele venceu a morte e me deu a vida eterna';
    expect(classificarTexto(hino).veredicto).toBe('limpo');
  });

  it('"baseado em uma história real" não é maconha', () => {
    expect(classificarTexto('essa canção é baseada em uma história real').veredicto).toBe('limpo');
    expect(classificarTexto('baseado na palavra de Deus eu sigo').veredicto).toBe('limpo');
  });

  it('mas "acendeu um baseado" com outra pista condena', () => {
    // A guarda é de contexto, não de perdão: seguido de vizinho inocente ele
    // não conta; usado como droga, conta.
    const r = classificarTexto('acendeu um baseado e fumou o skunk inteiro');
    expect(r.veredicto).toBe('explicito');
  });

  it('palavra dentro de outra palavra não conta', () => {
    // 'puta' está dentro de 'reputação'; 'foda' dentro de 'fodase' já é termo
    // próprio, mas 'sacoda' não pode virar palavrão.
    expect(classificarTexto('a reputação dela é impecável').veredicto).toBe('limpo');
    expect(classificarTexto('que se sacoda o povo todo').veredicto).toBe('limpo');
  });

  it('UM xingamento leve sozinho não condena a música', () => {
    // "que merda" aparece em música que ninguém chamaria de explícita. Leve
    // precisa de companhia.
    expect(classificarTexto('que merda de dia foi esse').veredicto).toBe('limpo');
  });

  it('mas dois leves juntos condenam', () => {
    expect(classificarTexto('que merda, seu corno safado').veredicto).toBe('explicito');
  });

  it('violência NUNCA condena, nem acumulada', () => {
    // Duas ocorrências de violência ainda somam zero para a condenação: o teste
    // trava a defesa nº 2 do módulo.
    const r = classificarTexto('a pistola e o fuzil na capa do filme de guerra');
    expect(r.veredicto).toBe('limpo');
    expect(r.categorias).toContain('violencia');
  });
});

describe('conteúdo explícito — reconhecer o que é', () => {
  it('palavrão forte condena sozinho', () => {
    expect(classificarTexto('caralho que música foda').veredicto).toBe('explicito');
  });

  it('atravessa acento e caixa alta', () => {
    expect(classificarTexto('PORRA, que CARALHO é esse').veredicto).toBe('explicito');
    expect(classificarTexto('tráfico na quebrada').veredicto).toBe('explicito');
  });

  it('desfaz o disfarce: p0rra, c@ralho, fuuuuuck', () => {
    // Sem isto o filtro só pega quem não estava tentando escapar.
    expect(classificarTexto('p0rra nenhuma').veredicto).toBe('explicito');
    expect(classificarTexto('c@r@lho').veredicto).toBe('explicito');
    expect(classificarTexto('fuuuuuck this').veredicto).toBe('explicito');
  });

  it('não colapsa letra dobrada legítima', () => {
    // 'nossa', 'terra', 'passar' têm letra dobrada correta — reduzi-las
    // quebraria o texto antes de analisá-lo.
    expect(normalizarParaAnalise('nossa terra vai passar')).toBe('nossa terra vai passar');
    expect(normalizarParaAnalise('caraaaalho')).toBe('caralho');
  });

  it('expressão de droga é reconhecida inteira', () => {
    expect(classificarTexto('comprou na boca de fumo').categorias).toContain('drogas');
    expect(classificarTexto('cheirando cocaina a noite toda').categorias).toContain('drogas');
  });
});

describe('classificarFaixa — as três respostas', () => {
  it('SEM LETRA é desconhecido, nunca limpo', () => {
    // A decisão que faz o sistema ser honesto: ausência de prova não é prova de
    // inocência. Um filtro que responde "limpo" quando não sabe falha
    // exatamente na cara de quem confiou nele.
    const r = classificarFaixa({ titulo: 'Canção Bonita', letra: null });
    expect(r.veredicto).toBe('desconhecido');
  });

  it('título sujo dispensa a letra', () => {
    // Título é evidência de condenação, nunca de inocência.
    const r = classificarFaixa({ titulo: 'Putaria no Baile', letra: null });
    expect(r.veredicto).toBe('explicito');
  });

  it('letra limpa com título limpo é limpo', () => {
    const r = classificarFaixa({
      titulo: 'Amanhecer',
      letra: 'o sol nasceu de novo e eu sorri pra você',
    });
    expect(r.veredicto).toBe('limpo');
  });

  it('guarda os achados para poder auditar o léxico', () => {
    // Sem isto, corrigir um falso positivo vira adivinhação: não dá para saber
    // QUAL termo condenou a faixa.
    const r = classificarTexto('caralho');
    expect(r.achados).toContain('caralho');
  });
});
