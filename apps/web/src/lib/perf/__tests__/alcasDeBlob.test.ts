/**
 * O ORÇAMENTO DE ALÇAS — o conserto do "a aba passa de 1,4 GB parada".
 *
 * O app já tinha teto de alças de blob, e mesmo assim estourava a memória. O
 * teto contava a coisa errada: 60 ALÇAS são 60 MB numa biblioteca de MP3 curto
 * e 2,4 GB numa de FLAC. O mesmo número, o mesmo "limite respeitado", quarenta
 * vezes a memória.
 *
 * Pior, o teto existia DUAS VEZES — uma cópia em `localLibrary`, outra em
 * `downloadManager` — e cada cópia respeitava o próprio limite sem saber da
 * outra. Os dois cheios eram o dobro do que qualquer um dos dois prometia, e
 * ninguém no app conseguia responder "quanto a aba está segurando agora".
 *
 * O contrato que estes testes prendem:
 *   1. o limite é em BYTES, não em contagem;
 *   2. o que sai é revogado de verdade (senão o teto é decorativo);
 *   3. a alça recém-usada nunca é a despejada — soltar o áudio que está
 *      tocando emudeceria a música na hora;
 *   4. um arquivo gigante sozinho não consegue esvaziar o cofre;
 *   5. quem guardou a URL fica sabendo que ela morreu;
 *   6. a conta é consultável, porque nenhuma API do navegador conta estes bytes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const alcas = { abertas: new Set<string>(), criadas: 0 };

/** Blob de mentira com o tamanho pedido — sem alocar os bytes de verdade. */
const blobDe = (bytes: number): Blob => ({ size: bytes, type: 'audio/mpeg' }) as Blob;

beforeEach(async () => {
  alcas.abertas.clear();
  alcas.criadas = 0;
  vi.stubGlobal('URL', {
    createObjectURL: () => {
      const url = `blob:fake/${alcas.criadas++}`;
      alcas.abertas.add(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      alcas.abertas.delete(url);
    },
  });
  vi.resetModules();
});

describe('orçamento de alças de blob', () => {
  it('o teto é em BYTES: poucos arquivos enormes já estouram', async () => {
    const { abrir, relatorio } = await import('@/lib/perf/alcasDeBlob');

    // Dez FLACs de 40 MB = 400 MB. Pelo teto ANTIGO (60 alças) isso passava
    // folgado: dez é muito menos que sessenta, então nada era despejado e a aba
    // segurava os 400 MB inteiros. É exatamente este o caso que contagem não
    // enxerga e bytes enxergam.
    for (let i = 0; i < 10; i++) abrir('audio', `flac-${i}`, blobDe(40_000_000));

    const { audio } = relatorio();
    expect(audio.alcas).toBeLessThan(10);
    expect(audio.bytes).toBeLessThan(400_000_000);
  });

  it('o que sai do orçamento é revogado de verdade, não só esquecido', async () => {
    const { abrir } = await import('@/lib/perf/alcasDeBlob');

    for (let i = 0; i < 10; i++) abrir('audio', `flac-${i}`, blobDe(40_000_000));

    // Esquecer sem revogar deixaria o navegador segurando os bytes assim mesmo:
    // o teto seria contabilidade, não memória liberada.
    expect(alcas.criadas).toBe(10);
    expect(alcas.abertas.size).toBeLessThan(10);
  });

  it('a alça recém-usada nunca é a despejada', async () => {
    const { abrir, consultar } = await import('@/lib/perf/alcasDeBlob');

    const tocando = abrir('audio', 'tocando', blobDe(8_000_000));
    // Uma enxurrada de outras faixas passa por cima...
    for (let i = 0; i < 40; i++) {
      abrir('audio', `outra-${i}`, blobDe(8_000_000));
      consultar('audio', 'tocando'); // ...mas a que toca segue sendo consultada
    }

    // Se esta alça caísse, a música emudeceria no meio.
    expect(consultar('audio', 'tocando')).toBe(tocando);
    expect(alcas.abertas.has(tocando)).toBe(true);
  });

  it('consultar conta como uso: a capa parada na tela não envelhece', async () => {
    const { abrir, consultar } = await import('@/lib/perf/alcasDeBlob');

    const naTela = abrir('capa', 'visivel', blobDe(20_000));
    for (let i = 0; i < 200; i++) {
      abrir('capa', `rolando-${i}`, blobDe(20_000));
      consultar('capa', 'visivel');
    }

    expect(consultar('capa', 'visivel')).toBe(naTela);
  });

  it('o piso de alças VENCE o teto de bytes, e isso é proposital', async () => {
    const { abrir, relatorio } = await import('@/lib/perf/alcasDeBlob');

    for (let i = 0; i < 10; i++) abrir('audio', `flac-${i}`, blobDe(40_000_000));

    // Três alças de 40 MB são 120 MB e cabem; mas se cada arquivo tivesse 60 MB
    // o piso seguraria 180 MB acima do teto de 128 MB — de caso pensado. O piso
    // é a anterior, a atual e a próxima: despejar aí emudeceria a música que
    // está tocando, que é um estrago pior que o excesso de memória.
    //
    // Este teste existe para que o piso seja uma DECISÃO e não um descuido: se
    // alguém apertar o teto de bytes esperando um limite absoluto, quebra aqui.
    expect(relatorio().audio.alcas).toBe(3);
  });

  it('um arquivo sozinho maior que o orçamento não esvazia o cofre', async () => {
    const { abrir, consultar, relatorio } = await import('@/lib/perf/alcasDeBlob');

    abrir('audio', 'anterior', blobDe(5_000_000));
    abrir('audio', 'tocando', blobDe(5_000_000));
    // Um DJ set de 900 MB num arquivo só. Existe, e não pode ser o gatilho que
    // solta a alça da faixa que está tocando agora.
    abrir('audio', 'monstro', blobDe(900_000_000));

    expect(relatorio().audio.alcas).toBeGreaterThanOrEqual(2);
    expect(consultar('audio', 'tocando')).not.toBeNull();
  });

  it('quem guardou a URL fica sabendo quando ela é despejada', async () => {
    const { abrir, aoDespejar } = await import('@/lib/perf/alcasDeBlob');

    const despejadas: string[] = [];
    aoDespejar('audio', (chave) => despejadas.push(chave));

    for (let i = 0; i < 10; i++) abrir('audio', `flac-${i}`, blobDe(40_000_000));

    // Sem este aviso, o `coverUrl` de uma faixa continuaria apontando para um
    // `blob:` revogado — imagem quebrada na tela, que é pior que o ícone padrão.
    expect(despejadas.length).toBeGreaterThan(0);
    expect(despejadas[0]).toBe('flac-0'); // a mais antiga sai primeiro
  });

  it('os dois cofres têm orçamentos separados e não se roubam', async () => {
    const { abrir, consultar, relatorio } = await import('@/lib/perf/alcasDeBlob');

    const capa = abrir('capa', 'capa-1', blobDe(20_000));
    // Áudio enchendo até despejar não pode arrastar as capas junto: são
    // orçamentos diferentes porque têm donos e tamanhos diferentes.
    for (let i = 0; i < 10; i++) abrir('audio', `flac-${i}`, blobDe(40_000_000));

    expect(consultar('capa', 'capa-1')).toBe(capa);
    expect(relatorio().capa.alcas).toBe(1);
  });

  it('reabrir a mesma chave não deixa a alça anterior vazando', async () => {
    const { abrir, relatorio } = await import('@/lib/perf/alcasDeBlob');

    abrir('capa', 'mesma', blobDe(20_000));
    abrir('capa', 'mesma', blobDe(30_000));

    // Duas criadas, uma viva: a primeira foi revogada ao ser substituída. Sem
    // isso, cada recapa de uma faixa deixaria um arquivo preso para sempre.
    expect(alcas.criadas).toBe(2);
    expect(alcas.abertas.size).toBe(1);
    expect(relatorio().capa.bytes).toBe(30_000);
  });

  it('soltar devolve os bytes à conta', async () => {
    const { abrir, consultar, relatorio, soltar } = await import('@/lib/perf/alcasDeBlob');

    abrir('audio', 't1', blobDe(8_000_000));
    expect(relatorio().audio.bytes).toBe(8_000_000);

    soltar('audio', 't1');

    // A conta é a única fonte sobre estes bytes: se ela não voltar a zero, o
    // orçamento vai apertando sozinho até despejar coisa que devia ficar.
    expect(relatorio().audio.bytes).toBe(0);
    expect(consultar('audio', 't1')).toBeNull();
    expect(alcas.abertas.size).toBe(0);
  });

  it('consultar uma chave que nunca existiu não inventa alça', async () => {
    const { consultar } = await import('@/lib/perf/alcasDeBlob');

    expect(consultar('audio', 'nunca-existiu')).toBeNull();
    expect(alcas.criadas).toBe(0);
  });

  /**
   * RNF3 — dez trocas de faixa não deixam dez arquivos abertos.
   *
   * É a forma que o vazamento tinha no ar: cada faixa que tocava abria a sua
   * alça e ninguém soltava, então "ouvir um álbum" era o mesmo que abrir o
   * álbum inteiro na memória. Nenhuma API do navegador contava isso — o heap
   * marcava 12 MB enquanto a aba passava de 1 GB —, e é por isso que a prova
   * tem que ser esta conta, e não a do `performance.memory`.
   */
  it('dez trocas de faixa: as alças ficam no orçamento e zeram ao desmontar', async () => {
    const { abrir, consultar, relatorio, esquecerTudo } = await import('@/lib/perf/alcasDeBlob');

    for (let i = 0; i < 10; i++) {
      const chave = `faixa-${i}`;
      abrir('audio', chave, blobDe(8_000_000)); // 8 MB por faixa, 80 MB no total
      consultar('audio', chave); // é o que o player faz ao tocar
    }

    // O despejo é por USO, e a última a entrar é a que está tocando: ela nunca
    // pode ser a despejada, porque soltar a alça emudece a música na hora.
    expect(consultar('audio', 'faixa-9')).not.toBeNull();
    expect(alcas.abertas.size).toBe(relatorio().audio.alcas);

    // Desmontar (fechar a aba, trocar de usuário) devolve tudo.
    esquecerTudo();
    expect(relatorio().audio.alcas).toBe(0);
    expect(relatorio().audio.bytes).toBe(0);
    expect(alcas.abertas.size).toBe(0);
  });
});
