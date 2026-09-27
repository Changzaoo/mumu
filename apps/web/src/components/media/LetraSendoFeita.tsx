/**
 * "NOSSO TIME ESTÁ TRANSCREVENDO A LETRA AGORA" — a letra aparecendo ao vivo.
 *
 * Quando uma música não tem letra publicada em lugar nenhum, o importador a
 * transcreve do próprio áudio. Isso leva minutos para a música inteira, e uma
 * tela "sem letra" parada esse tempo todo parece defeito. Aqui a pessoa vê o
 * trabalho acontecendo: até onde da música já foi ouvido e as palavras
 * surgindo uma a uma, conforme o modelo as reconhece.
 *
 * SÓ O QUE FOI OUVIDO COM CONFIANÇA. A palavra duvidosa não aparece — letra
 * inventada é pior que letra incompleta (é a mesma regra de
 * `transcricaoConfiavel`, em lib/lyrics/recalibrar.ts).
 */
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { AudioLines } from 'lucide-react';
import { assinarLetraAoVivo, letraAoVivo, type LetraAoVivo } from '@/lib/lyrics/calibragem';
import { palavrasEmLinhas } from '@/lib/lyrics/recalibrar';
import { cn, formatDuration } from '@/lib/utils';

/** Confiança mínima para a palavra aparecer (a mesma da letra final). */
const CONFIANCA = 0.6;
/** Intervalo entre palavras novas surgindo — "digitando" o que chegou. */
const PASSO_MS = 90;

export function useLetraAoVivo(trackId: string): LetraAoVivo | null {
  return useSyncExternalStore(
    assinarLetraAoVivo,
    () => letraAoVivo(trackId),
    () => null,
  );
}

export function LetraSendoFeita({
  vivo,
  duracaoMs,
  className,
}: {
  vivo: LetraAoVivo;
  duracaoMs: number;
  className?: string;
}) {
  const palavras = useMemo(
    () => (vivo.parcial?.words ?? []).filter((w) => w.prob === undefined || w.prob >= CONFIANCA),
    [vivo.parcial],
  );
  const linhas = useMemo(() => palavrasEmLinhas(palavras), [palavras]);
  // Quantas já estavam na tela antes desta leva: só as NOVAS entram animadas,
  // em sequência — as antigas não piscam de novo a cada atualização.
  const jaMostradas = useRef(0);
  const anteriores = jaMostradas.current;
  jaMostradas.current = palavras.length;

  const ouvido = vivo.parcial?.ouvidoMs ?? 0;
  const titulo =
    vivo.fase === 'na-fila'
      ? 'Nosso time vai transcrever a letra desta música em instantes'
      : 'Nosso time está transcrevendo a letra agora';

  let indice = 0;
  return (
    <div className={cn('no-scrollbar h-full overflow-y-auto px-3 py-8', className)} aria-live="polite">
      <div className="mb-6 flex items-start gap-3">
        <AudioLines className="mt-0.5 size-5 shrink-0 animate-pulse text-fg" aria-hidden />
        <div>
          <p className="font-semibold text-fg">{titulo}</p>
          <p className="text-sm text-fg-muted">
            {vivo.fase === 'transcrevendo' && ouvido > 0
              ? `Ouvindo a música… ${formatDuration(ouvido)} de ${formatDuration(duracaoMs)}`
              : 'Ouvindo a música…'}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {linhas.map((linha, i) => (
          <p key={`${linha.timeMs}-${i}`} className="text-xl font-bold tracking-tight text-fg-muted sm:text-2xl">
            {(linha.words ?? []).map((w, k) => {
              const n = indice++;
              const nova = n >= anteriores;
              return (
                <span
                  key={`${w.timeMs}-${k}`}
                  className={cn(nova && 'letra-surgindo')}
                  style={nova ? { animationDelay: `${(n - anteriores) * PASSO_MS}ms` } : undefined}
                >
                  {w.text}{' '}
                </span>
              );
            })}
          </p>
        ))}
        <span className="inline-block h-6 w-1.5 animate-pulse rounded-full bg-fg/60 align-middle" aria-hidden />
      </div>
    </div>
  );
}
