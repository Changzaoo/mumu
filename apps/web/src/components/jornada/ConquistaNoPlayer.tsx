/**
 * A CONQUISTA SALTA DE DENTRO DO PLAYER — como no Xbox (pedido do dono,
 * 29/10/2026): um círculo com o ícone pula da borda do player, abre numa
 * pílula com "Conquista desbloqueada", toca um plim agradável e some sozinha.
 * Um toque abre o detalhe ali mesmo (descrição, raridade, XP, a próxima da
 * série), sem sair do que a pessoa está fazendo.
 *
 * Uma por vez, na ordem em que foram ganhas; espera a abertura sair e a tela
 * estar acesa (conquista ganha com a tela apagada salta quando a pessoa volta).
 * Só transform e opacity no salto — o celular fraco não engasga.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { useSemMovimento } from '@/hooks/useSemMovimento';
import { CONQUISTAS, NOME_DA_RARIDADE, type Conquista } from '@/lib/jornada/conquistas';
import * as jornada from '@/lib/jornada/jornada';
import { tocarPlim } from '@/lib/jornada/som';
import { COR_DA_RARIDADE } from '@/lib/jornada/visual';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '@/stores/playerStore';
import { Desenho } from '@/components/icones/Desenho';

/** Quanto a pílula fica aberta sem toque. */
const NA_TELA_MS = 5_200;

const telaPronta = (): boolean => !document.hidden && !document.getElementById('abertura');

/** A próxima conquista da mesma série ainda não ganha (ex.: 7 → 14 dias). */
function proximaDaSerie(q: Conquista): Conquista | null {
  const estado = jornada.snapshot();
  return (
    CONQUISTAS.find((o) => o.grupo === q.grupo && o.id !== q.id && !estado.conquistas[o.id]) ?? null
  );
}

export function ConquistaNoPlayer() {
  const naFila = useSyncExternalStore(jornada.subscribeFila, jornada.proximaDaFila, () => null);
  const [atual, setAtual] = useState<Conquista | null>(null);
  const [aberta, setAberta] = useState(false);
  const [detalhe, setDetalhe] = useState(false);
  const temPlayer = usePlayerStore((s) => Boolean(s.currentTrack));
  const semMovimento = useSemMovimento();
  const navigate = useNavigate();

  // Pega a próxima da fila quando a tela estiver pronta para ela.
  useEffect(() => {
    if (atual || !naFila) return;
    let t: number | undefined;
    const tentar = (): void => {
      if (!telaPronta()) {
        t = window.setTimeout(tentar, 800);
        return;
      }
      setAtual(naFila);
      setDetalhe(false);
      tocarPlim();
      if ('vibrate' in navigator) navigator.vibrate?.(18);
    };
    t = window.setTimeout(tentar, 400);
    return () => window.clearTimeout(t);
  }, [atual, naFila]);

  // O círculo salta primeiro; a pílula abre logo depois. (Efeito próprio: no
  // de cima, trocar `atual` rodava a limpeza e cancelava este timer.)
  useEffect(() => {
    if (!atual) return;
    const t = window.setTimeout(() => setAberta(true), semMovimento ? 0 : 420);
    return () => window.clearTimeout(t);
  }, [atual, semMovimento]);

  // Some sozinha — a não ser que a pessoa tenha aberto o detalhe.
  useEffect(() => {
    if (!atual || detalhe) return;
    const t = window.setTimeout(fechar, NA_TELA_MS);
    return () => window.clearTimeout(t);
  }, [atual, detalhe]);

  function fechar(): void {
    setAberta(false);
    setDetalhe(false);
    window.setTimeout(() => {
      setAtual(null);
      jornada.tirarDaFila();
    }, 260);
  }

  const cor = atual ? COR_DA_RARIDADE[atual.raridade] : '#fff';
  const proxima = atual && detalhe ? proximaDaSerie(atual) : null;
  const progresso = proxima ? proxima.progresso(jornada.contexto()) : null;

  return (
    <div
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-3',
        temPlayer
          ? 'bottom-[calc(8rem+env(safe-area-inset-bottom)+10px)] md:bottom-[104px]'
          : 'bottom-[calc(4rem+env(safe-area-inset-bottom)+12px)] md:bottom-6',
      )}
    >
      <AnimatePresence>
        {atual && (
          <motion.div
            key={atual.id}
            initial={{ opacity: 0, y: 46, scale: 0.4 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.85 }}
            transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            className="pointer-events-auto"
          >
            <button
              type="button"
              data-testid="conquista-no-player"
              aria-expanded={detalhe}
              onClick={() => setDetalhe((d) => !d)}
              className={cn(
                'relative flex items-center overflow-hidden text-left text-white shadow-2xl transition-[max-width] duration-300 ease-out',
                detalhe
                  ? 'w-[min(92vw,380px)] flex-col items-stretch rounded-3xl p-4'
                  : 'rounded-full p-1.5',
              )}
              style={{
                background: 'linear-gradient(135deg,#17171c,#25252e)',
                boxShadow: `0 10px 40px -10px ${cor}88, 0 0 0 1px ${cor}55 inset`,
                maxWidth: detalhe ? undefined : aberta ? 360 : 60,
              }}
            >
              <span className="flex items-center">
                {/* o círculo do ícone, com o anel da raridade */}
                <span
                  className="relative grid size-12 shrink-0 place-items-center rounded-full text-2xl"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${cor}55, ${cor}18 70%)`,
                    boxShadow: `0 0 0 2px ${cor}`,
                  }}
                >
                  {!semMovimento && (
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 rounded-full"
                      style={{ boxShadow: `0 0 0 2px ${cor}` }}
                      initial={{ scale: 1, opacity: 0.9 }}
                      animate={{ scale: 1.9, opacity: 0 }}
                      transition={{ duration: 0.9, ease: 'easeOut', delay: 0.15 }}
                    />
                  )}
                  <Desenho nome={atual.icone} />
                </span>
                <span
                  className={cn(
                    'min-w-0 whitespace-nowrap pl-3 pr-4 transition-opacity duration-200',
                    aberta ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  <span
                    className="block text-[11px] font-medium uppercase tracking-[0.12em]"
                    style={{ color: cor }}
                  >
                    <Desenho nome="trofeu" /> Conquista desbloqueada
                  </span>
                  <span className="block truncate text-[15px] font-semibold">
                    {atual.nome}
                    <span className="ml-2 text-xs font-medium text-white/60">+{atual.xp} XP</span>
                  </span>
                </span>
              </span>

              {detalhe && (
                <span className="mt-3 block space-y-3 whitespace-normal">
                  <span className="block text-sm text-white/80">{atual.descricao}</span>
                  <span className="flex flex-wrap gap-2 text-[11px] font-medium">
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{ background: `${cor}26`, color: cor }}
                    >
                      {NOME_DA_RARIDADE[atual.raridade]}
                    </span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5">{atual.grupo}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5">+{atual.xp} XP</span>
                  </span>
                  {proxima && progresso && (
                    <span className="block rounded-xl bg-white/5 p-3">
                      <span className="flex items-center justify-between text-xs text-white/70">
                        <span>
                          Próxima: <Desenho nome={proxima.icone} /> {proxima.nome}
                        </span>
                        <span>
                          {Math.min(progresso[0], progresso[1])}/{progresso[1]}
                        </span>
                      </span>
                      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (progresso[0] / progresso[1]) * 100)}%`,
                            background: COR_DA_RARIDADE[proxima.raridade],
                          }}
                        />
                      </span>
                    </span>
                  )}
                  <span className="flex gap-2">
                    <span
                      role="link"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        fechar();
                        navigate('/jornada');
                      }}
                      className="flex-1 rounded-full bg-white py-2 text-center text-sm font-semibold text-black"
                    >
                      Ver minhas conquistas
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        fechar();
                      }}
                      className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium"
                    >
                      Fechar
                    </span>
                  </span>
                </span>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
