import { describe, expect, it } from 'vitest';
import {
  ADIANTO_DO_OUVIDO_S,
  ASSENTAR_MS,
  decidir,
  estadoInicial,
  idDoVideo,
} from '@/lib/clipe/sincronia';

/**
 * Simula o vídeo do YouTube seguindo o som: o `seekTo` leva `atraso` segundos
 * para voltar a tocar, o relógio do vídeo chega com ruído, e o ritmo pedido
 * vale (arredondado a 0,05×, como o YouTube faz).
 */
function simular(opts: { atraso: number; ruido: number; video0: number; audio0: number }) {
  let e = estadoInicial();
  let audio = opts.audio0;
  let video = opts.video0;
  let agora = 0;
  let ritmo = 1;
  let saltos = 0;
  let casouEm: number | null = null;
  const erros: number[] = [];
  let semente = 7;
  const aleatorio = (): number => ((semente = (semente * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < 160; i++) {
    const lido = video + aleatorio() * opts.ruido;
    const d = decidir(e, { video: lido, audio, agora });
    e = d.estado;
    if (d.casado && casouEm === null) casouEm = agora;
    ritmo = Math.round(d.ritmo * 20) / 20;
    const passo = 0.25;
    if (d.saltarPara !== null) {
      saltos++;
      video = d.saltarPara + Math.max(0, passo - opts.atraso);
    } else video += passo * ritmo;
    audio += passo;
    agora += passo * 1000;
    erros.push(video - (audio + ADIANTO_DO_OUVIDO_S));
  }
  return { saltos, casouEm, erroFinal: Math.abs(erros.at(-1) as number), e };
}

describe('decidir', () => {
  it('vídeo no tempo do som: aparece, não salta, não mexe na velocidade', () => {
    const d = decidir(estadoInicial(), { video: 42 + ADIANTO_DO_OUVIDO_S, audio: 42, agora: 1000 });
    expect(d.saltarPara).toBeNull();
    expect(d.ritmo).toBe(1);
    expect(d.casado).toBe(true);
  });

  it('vídeo longe do som: salta na hora, um pouco adiante', () => {
    const d = decidir(estadoInicial(), { video: 3, audio: 42, agora: 1000 });
    expect(d.casado).toBe(false);
    expect(d.saltarPara).toBeGreaterThan(42 + ADIANTO_DO_OUVIDO_S);
  });

  it('não mede enquanto o salto assenta', () => {
    const e = decidir(estadoInicial(), { video: 3, audio: 42, agora: 1000 }).estado;
    const d = decidir(e, { video: 3, audio: 42.5, agora: 1000 + ASSENTAR_MS - 1 });
    expect(d.saltarPara).toBeNull();
  });

  it('erro pequeno se corrige acelerando, não saltando', () => {
    let e = estadoInicial();
    let d = decidir(e, { video: 10, audio: 10, agora: 0 });
    for (let i = 1; i <= 4; i++) {
      e = d.estado;
      d = decidir(e, { video: 10 + i * 0.25, audio: 10 + i * 0.25, agora: i * 250 });
    }
    // vídeo 0,1 s atrás do alvo (o alvo é o som + o adianto do ouvido)
    expect(d.saltarPara).toBeNull();
    expect(d.ritmo).toBeGreaterThan(1);
  });

  it('uma leitura torta isolada não dispara salto', () => {
    let e = estadoInicial();
    const alvo = (t: number): number => t + ADIANTO_DO_OUVIDO_S;
    for (let i = 0; i < 4; i++) e = decidir(e, { video: alvo(i), audio: i, agora: i * 250 }).estado;
    const d = decidir(e, { video: alvo(4) + 0.6, audio: 4, agora: 1000 });
    expect(d.saltarPara).toBeNull();
  });

  it.each([
    { atraso: 0.3, ruido: 0 },
    { atraso: 0.6, ruido: 0.05 },
    { atraso: 0.9, ruido: 0.1 },
  ])('com salto lento ($atraso s) e ruído ($ruido s) casa e fica casado', (o) => {
    const r = simular({ ...o, video0: 30, audio0: 54 });
    expect(r.casouEm).not.toBeNull();
    expect(r.casouEm as number).toBeLessThan(5_000);
    expect(r.saltos).toBeLessThanOrEqual(4);
    expect(r.erroFinal).toBeLessThan(0.08);
  });
});

describe('idDoVideo', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://open.spotify.com/track/abc', null],
    ['lixo', null],
    [null, null],
  ])('%s → %s', (url, id) => {
    expect(idDoVideo(url)).toBe(id);
  });
});
