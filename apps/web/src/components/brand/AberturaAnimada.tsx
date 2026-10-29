/**
 * A ABERTURA — o logo do radinho se desenhando, como num estúdio de motion.
 *
 * Pedido do dono (20/10/2026): uma animação de abertura OBRIGATÓRIA — ela é
 * a tela de carregamento: enquanto corre, o app sobe por baixo (sessão,
 * fontes, biblioteca). Só sai quando as duas coisas acontecem: a cena
 * terminou E o app está pronto. App pronto antes, a cena vai até o fim; app
 * atrasado, o logo final fica parado na tela até ele chegar (com um teto,
 * para nunca prender ninguém numa tela vazia).
 *
 * DIREÇÃO DE ARTE (29/10/2026): um "logo animation concept" no estilo do post
 * de referência do dono (instagram.com/p/De5mKk2MT8P) — o símbolo construído
 * como numa ferramenta de desenho, um corte em negativo, o nome escrito letra
 * a letra, uma vitrine rápida e o logo final.
 *
 * A CENA NÃO É DESTE COMPONENTE (29/10/2026, Moto G34 "toda lagada"): ela mora
 * no index.html, em HTML e CSS puros, e começa no primeiro quadro — ver
 * `aberturaCena.ts`. Este componente só a CONTROLA: quando sai, o "Pular", o
 * Esc, o diário e a remoção do DOM.
 */
import { useEffect, useState } from 'react';
import { useAuthUser } from '@/hooks/useAuthUser';
import { anotar } from '@/lib/telemetry/diario';
import { DURACAO_DA_CENA_MS } from './aberturaCena';

export { DURACAO_DA_CENA_MS };
/** Teto de espera pelo app (ms): depois disto a abertura sai de qualquer jeito. */
const TETO_DE_ESPERA_MS = 20_000;
/** Saída: o tempo do fade (ms) — o mesmo `transition` do CSS da cena. */
export const SAIDA_MS = 700;

/** O app está pronto por baixo? Sessão resolvida e fontes carregadas. */
function useAppPronto(): boolean {
  const { loading } = useAuthUser();
  const [fontes, setFontes] = useState(false);
  useEffect(() => {
    let vivo = true;
    const pronto = (): void => {
      if (vivo) setFontes(true);
    };
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready.then(pronto, pronto);
    } else pronto();
    return () => {
      vivo = false;
    };
  }, []);
  return !loading && fontes;
}

const raiz = (): HTMLElement => document.documentElement;
const cena = (): HTMLElement | null => document.getElementById('abertura');

/** Quanto da cena já passou: ela começou no primeiro quadro, não na montagem. */
function jaPassou(): number {
  const t0 = (window as Window & { __aberturaT0?: number }).__aberturaT0;
  return typeof t0 === 'number' ? Math.max(0, performance.now() - t0) : 0;
}

export function AberturaAnimada() {
  const pronto = useAppPronto();
  // Sem a cena no DOM (recarga no meio do uso: o script do <head> a dispensou),
  // não há o que controlar.
  const [viva] = useState(() => Boolean(cena()) && raiz().hasAttribute('data-abrindo'));
  const [cenaAcabou, setCenaAcabou] = useState(
    () =>
      raiz().hasAttribute('data-abertura-pulada') || raiz().hasAttribute('data-abertura-parada'),
  );
  const [teto, setTeto] = useState(false);
  const [fechada, setFechada] = useState(!viva);

  useEffect(() => {
    if (!viva) {
      cena()?.remove();
      anotar('app', 'abertura', 'dispensada: já vista nesta sessão');
      return;
    }
    anotar('app', 'abertura', 'mostrada');
    const passou = jaPassou();
    const a = setTimeout(() => setCenaAcabou(true), Math.max(0, DURACAO_DA_CENA_MS - passou));
    const b = setTimeout(() => setTeto(true), Math.max(0, TETO_DE_ESPERA_MS - passou));
    // "Pular" (o botão da cena já marca o <html> sozinho, mesmo antes do app
    // carregar) e Esc fazem a mesma coisa: a cena acaba na hora e a abertura
    // sai assim que o app estiver pronto por baixo.
    const pular = (): void => {
      if (!raiz().hasAttribute('data-abertura-pulada')) {
        raiz().setAttribute('data-abertura-pulada', '1');
      }
      anotar('app', 'abertura', 'pulada');
      setCenaAcabou(true);
    };
    const botao = cena()?.querySelector('.ab-pular');
    botao?.addEventListener('click', pular);
    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') pular();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      botao?.removeEventListener('click', pular);
      window.removeEventListener('keydown', aoTeclar);
    };
  }, [viva]);

  const podeSair = viva && cenaAcabou && (pronto || teto);
  useEffect(() => {
    if (!podeSair) return;
    // O app volta a pintar por baixo e a cena some no fade.
    raiz().removeAttribute('data-abrindo');
    cena()?.classList.add('ab-saindo');
    const t = setTimeout(() => setFechada(true), SAIDA_MS);
    return () => clearTimeout(t);
  }, [podeSair]);

  useEffect(() => {
    if (!fechada) return;
    cena()?.remove();
    raiz().removeAttribute('data-abrindo');
    raiz().removeAttribute('data-abertura-pulada');
  }, [fechada]);

  return null;
}
