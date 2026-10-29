import { useSyncExternalStore } from 'react';
import { chaveDoDia } from '@/lib/jornada/datas';
import * as jornada from '@/lib/jornada/jornada';

/** O estado da jornada, re-renderizando a cada mudança. */
export function useJornada(): jornada.EstadoJornada {
  return useSyncExternalStore(jornada.subscribe, jornada.snapshot, jornada.snapshot);
}

/** 0..1 da meta de hoje. */
export function progressoDeHoje(e: jornada.EstadoJornada): number {
  return Math.min(1, (e.dias[chaveDoDia()] ?? 0) / (e.metaMin * 60));
}
