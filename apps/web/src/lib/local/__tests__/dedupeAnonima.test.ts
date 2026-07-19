/**
 * A mesma música importada duas vezes, uma sem crédito.
 *
 * Casos REAIS da biblioteca do usuário: "ÚLTIMA VEZ / ALEE" convivia com
 * "ÚLTIMA VEZ / Desconhecido"; "100% MOLHO FT. JOVEM DEX, LEVIANO E ALEE /
 * BRANDÃO85" com "100% MOLHO / Desconhecido". A chave de deduplicação incluía
 * o artista, então elas nunca casavam.
 *
 * Esta lógica APAGA faixas — por isso os testes cobrem tanto o que ela deve
 * juntar quanto, principalmente, o que ela NÃO pode encostar.
 */
import { describe, expect, it } from 'vitest';
import type { TrackDto } from '@aurial/shared';
import { artistaEhDesconhecido, tituloDuracaoKey } from '@/lib/local/localLibrary';

function t(title: string, artist: string | null, durationMs: number): TrackDto {
  return {
    id: `local:${title}:${artist ?? 'x'}`,
    title,
    durationMs,
    trackNumber: null,
    discNumber: null,
    explicit: false,
    playsCount: 0,
    coverUrl: null,
    dominantColor: null,
    loudnessLufs: null,
    album: null,
    artists: artist ? [{ id: 'a', name: artist, slug: '', imageUrl: null }] : [],
    streamUrl: null,
    uploadedByUserId: null,
  } as TrackDto;
}

describe('artistaEhDesconhecido', () => {
  it('reconhece lista vazia e o rótulo "Desconhecido"', () => {
    expect(artistaEhDesconhecido(t('X', null, 1000))).toBe(true);
    expect(artistaEhDesconhecido(t('X', 'Desconhecido', 1000))).toBe(true);
    expect(artistaEhDesconhecido(t('X', 'ALEE', 1000))).toBe(false);
  });
});

describe('tituloDuracaoKey', () => {
  it('junta a cópia com participantes e a cópia sem crédito', () => {
    // 4:51 nas duas.
    const completa = t('100% MOLHO FT. JOVEM DEX, LEVIANO E ALEE', 'BRANDÃO85', 291_000);
    const anonima = t('100% MOLHO', null, 291_000);
    expect(tituloDuracaoKey(completa)).toBe(tituloDuracaoKey(anonima));
  });

  it('ignora o número de faixa no começo do título', () => {
    const numerada = t('22 - SÃO PAULO feat. Klisman (prod. QualyWav1)', 'ALEE', 161_000);
    const limpa = t('SÃO PAULO', null, 161_000);
    expect(tituloDuracaoKey(numerada)).toBe(tituloDuracaoKey(limpa));
  });

  it('junta apesar da diferença de caixa e acento', () => {
    expect(tituloDuracaoKey(t('ÚLTIMA VEZ', 'ALEE', 153_000))).toBe(
      tituloDuracaoKey(t('ultima vez', null, 152_000)),
    );
  });

  it('NÃO junta músicas diferentes de mesma duração', () => {
    expect(tituloDuracaoKey(t('ESTRESSE', 'ALEE', 164_000))).not.toBe(
      tituloDuracaoKey(t('SEGREDO', null, 164_000)),
    );
  });

  it('NÃO junta a mesma música em durações distantes (ao vivo, remix)', () => {
    // 2:33 contra 4:10 — versões diferentes, ambas legítimas.
    expect(tituloDuracaoKey(t('ÚLTIMA VEZ', 'ALEE', 153_000))).not.toBe(
      tituloDuracaoKey(t('ÚLTIMA VEZ', null, 250_000)),
    );
  });

  it('recusa faixa sem duração — evidência fraca demais para apagar', () => {
    expect(tituloDuracaoKey(t('ÚLTIMA VEZ', 'ALEE', 0))).toBeNull();
  });

  it('recusa título genérico', () => {
    expect(tituloDuracaoKey(t('faixa', 'ALEE', 153_000))).toBeNull();
  });
});
