/**
 * AS REGRAS DO FOGUINHO — o que mantém, o que salva e o que apaga.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/local/localLikes', () => ({ count: () => 0, subscribe: () => () => undefined }));
vi.mock('@/lib/local/localPlaylists', () => ({ list: () => [], subscribe: () => () => undefined }));

import { semanaIso } from '../datas';
import * as j from '../jornada';

const META = j.META_PADRAO_MIN * 60;
const feito = (...dias: string[]) => Object.fromEntries(dias.map((d) => [d, META]));

describe('a sequência', () => {
  beforeEach(() => j.__reiniciar());

  it('hoje ainda por fazer não quebra a de ontem', () => {
    j.__reiniciar({ dias: feito('2026-10-27', '2026-10-28') });
    expect(j.calcularSequencia(j.snapshot(), '2026-10-29')).toBe(2);
  });

  it('hoje feito soma', () => {
    j.__reiniciar({ dias: feito('2026-10-27', '2026-10-28', '2026-10-29') });
    expect(j.calcularSequencia(j.snapshot(), '2026-10-29')).toBe(3);
  });

  it('meta não batida não conta', () => {
    j.__reiniciar({ dias: { '2026-10-28': META - 1 } });
    expect(j.calcularSequencia(j.snapshot(), '2026-10-29')).toBe(0);
  });

  it('um dia perdido com protetor: o protetor cobre e a chama continua', () => {
    j.__reiniciar({ dias: feito('2026-10-26', '2026-10-27'), protetores: 1 });
    const [e, acerto] = j.acertarFaltas(j.snapshot(), '2026-10-29');
    expect(acerto).toEqual({ tipo: 'protegeu', dias: 1 });
    expect(e.protetores).toBe(0);
    expect(j.calcularSequencia(e, '2026-10-29')).toBe(3);
  });

  it('dois dias perdidos com um protetor: apaga', () => {
    j.__reiniciar({ dias: feito('2026-10-25', '2026-10-26'), protetores: 1 });
    const [e, acerto] = j.acertarFaltas(j.snapshot(), '2026-10-29');
    expect(acerto).toEqual({ tipo: 'apagou', tinha: 2 });
    expect(e.protetores).toBe(1);
    expect(j.calcularSequencia(e, '2026-10-29')).toBe(0);
  });

  it('acerta uma vez só por dia', () => {
    j.__reiniciar({ dias: feito('2026-10-26'), protetores: 2 });
    const [e] = j.acertarFaltas(j.snapshot(), '2026-10-29');
    const [, de_novo] = j.acertarFaltas(e, '2026-10-29');
    expect(de_novo).toEqual({ tipo: 'nada' });
  });
});

describe('escuta, XP e conquistas', () => {
  beforeEach(() => j.__reiniciar({ semana: semanaIso() }));

  it('1 XP por minuto e +20 ao bater a meta, e a conquista entra na fila', () => {
    j.somarEscuta(META, new Date(2026, 9, 29, 14));
    const e = j.snapshot();
    expect(e.sequencia).toBe(1);
    // 15 min + meta + "Meta batida" (comum, 20)
    expect(e.xp).toBe(15 + 20 + 20);
    expect(e.conquistas['meta-batida']).toBeTruthy();
    expect(j.proximaDaFila()?.id).toBe('meta-batida');
  });

  it('ouvir de madrugada ganha a coruja', () => {
    j.somarEscuta(60, new Date(2026, 9, 29, 2));
    expect(j.snapshot().conquistas.coruja).toBeTruthy();
  });

  it('7 dias seguidos dão um protetor', () => {
    const dias = feito(
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    );
    j.__reiniciar({ dias, semana: semanaIso() });
    j.somarEscuta(META, new Date(2026, 9, 29, 15));
    expect(j.snapshot().sequencia).toBe(7);
    expect(j.snapshot().protetores).toBe(1);
    expect(j.snapshot().conquistas['seq-7']).toBeTruthy();
  });

  it('nível cresce com o XP', () => {
    expect(j.nivelDoXp(0).nivel).toBe(1);
    expect(j.nivelDoXp(60).nivel).toBe(2);
    expect(j.nivelDoXp(240).nivel).toBe(3);
  });
});

describe('semana ISO', () => {
  it('bate com o calendário', () => {
    expect(semanaIso(new Date(2026, 9, 29))).toBe('2026-W44');
    expect(semanaIso(new Date(2027, 0, 1))).toBe('2026-W53');
  });
});
