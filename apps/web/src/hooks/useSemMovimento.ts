import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * A PESSOA PEDIU MENOS MOVIMENTO? — a mesma resposta que o `MotionConfig` dá.
 *
 * O framer-motion já respeita o ajuste do app sozinho, mas só para o que ELE
 * anima — e mesmo assim deixa passar a opacidade. A fumaça do play é desenhada
 * à mão num canvas e a troca de capa decide ENTRE deslizar ou não: as duas
 * precisam da resposta em mãos. "Sistema" segue o `prefers-reduced-motion`;
 * "ligado"/"desligado" no app vencem o sistema, como no resto.
 */
export function useSemMovimento(): boolean {
  const ajuste = useSettingsStore((s) => s.reducedMotion);
  const doSistema = useMediaQuery('(prefers-reduced-motion: reduce)');
  if (ajuste === 'on') return true;
  if (ajuste === 'off') return false;
  return doSistema;
}
