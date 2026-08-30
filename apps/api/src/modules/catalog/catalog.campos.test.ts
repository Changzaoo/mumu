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

const vetor = Array.from({ length: 8 }, (_, i) => i / 10);
const noBanco = {
  track: { id: 'local:1', title: 'Faixa' },
  remoteUrl: 'https://cofre/1',
  dna: vetor,
};

describe('semCamposDoServidor', () => {
  it('tira o dna da listagem e não toca em mais nada', () => {
    const saida = semCamposDoServidor(noBanco);
    expect(saida).not.toHaveProperty('dna');
    expect(saida.track).toEqual({ id: 'local:1', title: 'Faixa' });
    expect(saida.remoteUrl).toBe('https://cofre/1');
  });

  it('devolve a MESMA referência quando não há nada a tirar', () => {
    const semDna = { track: { id: 'local:2' } };
    expect(semCamposDoServidor(semDna)).toBe(semDna);
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
