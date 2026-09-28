import { EQ_PRESETS } from '@radinho/shared';

/** Nome de cada preset do equalizador, como a interface mostra. */
export const PRESET_LABELS: Record<string, string> = {
  flat: 'Neutro',
  bass: 'Graves',
  treble: 'Agudos',
  vocal: 'Voz',
  electronic: 'Eletrônica',
  rock: 'Rock',
  acoustic: 'Acústico',
};

/** Ordem fixa dos presets: o comando remoto manda o ÍNDICE (o valor é numérico). */
export const PRESETS_EM_ORDEM = Object.keys(EQ_PRESETS);
