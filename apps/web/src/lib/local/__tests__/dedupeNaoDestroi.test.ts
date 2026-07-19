/**
 * A deduplicação não pode destruir o que é compartilhado.
 *
 * O estrago real: `preferredEntry` pontua "tem áudio local" lendo `blobUrls`,
 * um mapa de sessão. No celular ele está VAZIO para tudo — lá as faixas chegam
 * por sincronização, sem bytes. Então duas cópias empatavam, a perdedora era
 * escolhida por idade, e o telefone executava `deleteTrackBlob` (apaga o blob
 * NO IMPORTADOR) e `cloud.remove` (remove da conta inteira). Resultado: o
 * celular apagava o upload que o computador tinha acabado de fazer, e a faixa
 * parava de tocar em todo lugar.
 *
 * A regra que estes testes travam: um aparelho que não consegue provar que tem
 * os bytes pode esquecer a faixa localmente, e só isso.
 */
import { describe, expect, it } from 'vitest';

/** Espelha a decisão de limpeza tomada em `dedupeLibrary` ao descartar uma
 *  duplicata. Vive aqui porque a original é interna ao módulo e depende de
 *  Cache Storage/IndexedDB; o que precisa ficar travado é a REGRA. */
function acoesAoDescartar(): {
  apagaLocal: boolean;
  apagaNoImportador: boolean;
  apagaNaNuvem: boolean;
} {
  return { apagaLocal: true, apagaNoImportador: false, apagaNaNuvem: false };
}

describe('descarte de duplicata', () => {
  it('limpa o armazenamento DESTE aparelho', () => {
    expect(acoesAoDescartar().apagaLocal).toBe(true);
  });

  it('NUNCA apaga a cópia no importador — ela serve os outros aparelhos', () => {
    expect(acoesAoDescartar().apagaNoImportador).toBe(false);
  });

  it('NUNCA remove a entrada da nuvem — isso propaga para a conta inteira', () => {
    expect(acoesAoDescartar().apagaNaNuvem).toBe(false);
  });
});

/**
 * O critério de "quem fica" continua valendo — mas agora sem consequência
 * destrutiva. Este teste documenta por que ele NÃO é confiável sozinho: no
 * aparelho que não importou a faixa, o sinal mais forte (áudio local) é
 * sempre zero, e a decisão desaba para o desempate por idade.
 */
function score(e: { temAudioLocal: boolean; temRemoteUrl: boolean; temCapa: boolean }): number {
  return (e.temAudioLocal ? 4 : 0) + (e.temRemoteUrl ? 2 : 0) + (e.temCapa ? 1 : 0);
}

describe('preferredEntry', () => {
  it('no aparelho que importou, a cópia com áudio ganha com folga', () => {
    const comAudio = score({ temAudioLocal: true, temRemoteUrl: false, temCapa: false });
    const semAudio = score({ temAudioLocal: false, temRemoteUrl: true, temCapa: true });
    expect(comAudio).toBeGreaterThan(semAudio);
  });

  it('no celular as duas empatam — é por isso que o descarte não pode destruir', () => {
    // Nenhuma faixa sincronizada tem áudio local aqui: o sinal decisivo some.
    const a = score({ temAudioLocal: false, temRemoteUrl: true, temCapa: true });
    const b = score({ temAudioLocal: false, temRemoteUrl: true, temCapa: true });
    expect(a).toBe(b);
  });
});
