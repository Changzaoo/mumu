/**
 * O "PLIM" DA CONQUISTA — sintetizado na hora, sem arquivo.
 *
 * Três notas subindo (mi, si, mi uma oitava acima) com ataque suave e cauda
 * curta, baixinho por cima da música. Web Audio num contexto PRÓPRIO, aberto
 * só para o plim e fechado logo depois: não toca no <audio> do player (que tem
 * que continuar tocando com a tela apagada — ver audio-de-fundo) e não pede o
 * foco de áudio do Android, então a música não pausa.
 */
const NOTAS: Array<[freq: number, quando: number]> = [
  [659.25, 0],
  [987.77, 0.09],
  [1318.5, 0.18],
];

export function tocarPlim(volume = 0.13): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume().catch(() => undefined);
    const saida = ctx.createGain();
    saida.gain.value = volume;
    saida.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, quando] of NOTAS) {
      for (const [tipo, peso] of [
        ['sine', 1],
        ['triangle', 0.35],
      ] as const) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = tipo;
        osc.frequency.value = freq;
        const t = t0 + quando;
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(peso, t + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        osc.connect(env).connect(saida);
        osc.start(t);
        osc.stop(t + 0.95);
      }
    }
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1500);
  } catch {
    /* sem áudio: a conquista aparece em silêncio */
  }
}
