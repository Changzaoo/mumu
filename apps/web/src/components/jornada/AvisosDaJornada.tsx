/**
 * OS AVISOS DISCRETOS DA JORNADA.
 *
 *  - NA VOLTA (pedido do dono, 29/10/2026): ao abrir o app, depois que a
 *    abertura sai, um aviso pequeno diz onde a sequência está — "🔥 4 dias
 *    seguidos, faltam 9 min hoje", "🛡️ um protetor salvou sua sequência",
 *    "a chama apagou, bora acender de novo".
 *  - NO FIM DO DIA: a "coruja" do Duolingo, que o reel aponta como a primeira
 *    mudança que funcionou — depois das 20h, com a sequência viva e a meta de
 *    hoje por fazer, um lembrete (uma vez por dia).
 *  - Meta batida, protetor ganho e troca de liga, na hora em que acontecem.
 *
 * Tudo em toast curto, no topo: informa sem interromper.
 */
import { useEffect } from 'react';
import { toast } from 'sonner';
import { chaveDoDia } from '@/lib/jornada/datas';
import * as jornada from '@/lib/jornada/jornada';
import { aoChegarJornada, LIGAS } from '@/lib/jornada/servidor';

const CHAVE_LEMBRETE = 'radinho:jornada-lembrete';
// No TOPO: discreto, longe do player (onde as conquistas saltam) e das abas.
const DISCRETO = { duration: 4_500, position: 'top-center' } as const;

const dias = (n: number): string => `${n} ${n === 1 ? 'dia seguido' : 'dias seguidos'}`;

function faltaHoje(e: jornada.EstadoJornada): number {
  return Math.max(1, Math.ceil((e.metaMin * 60 - (e.dias[chaveDoDia()] ?? 0)) / 60));
}

/** Espera a abertura sair da tela. */
function depoisDaAbertura(fazer: () => void): () => void {
  let t = 0;
  const tentar = (): void => {
    if (document.getElementById('abertura')) t = window.setTimeout(tentar, 500);
    else t = window.setTimeout(fazer, 900);
  };
  tentar();
  return () => window.clearTimeout(t);
}

function lembreteDoFimDoDia(): void {
  const e = jornada.snapshot();
  const hoje = chaveDoDia();
  if (new Date().getHours() < 20 || e.sequencia === 0) return;
  if ((e.dias[hoje] ?? 0) >= e.metaMin * 60) return;
  try {
    if (window.localStorage.getItem(CHAVE_LEMBRETE) === hoje) return;
    window.localStorage.setItem(CHAVE_LEMBRETE, hoje);
  } catch {
    return;
  }
  toast(`Sua sequência de ${e.sequencia} dias acaba à meia-noite`, {
    ...DISCRETO,
    icon: '🦉',
    description: `Faltam ${faltaHoje(e)} min de música para manter o foguinho.`,
  });
}

export function AvisosDaJornada() {
  // A volta: uma vez por abertura do app.
  useEffect(() => {
    return depoisDaAbertura(() => {
      const e = jornada.snapshot();
      const hoje = (e.dias[chaveDoDia()] ?? 0) >= e.metaMin * 60;
      if (e.apagou > 0) {
        toast(`Sua sequência de ${dias(e.apagou)} apagou`, {
          ...DISCRETO,
          icon: '🕯️',
          description: `Ouça ${e.metaMin} min hoje e acenda de novo. Seu recorde: ${e.recorde}.`,
        });
        jornada.esquecerApagada();
      } else if (e.ultimoDia && Object.keys(e.dias).length === 0) {
        toast('Novidade: o foguinho do radinho', {
          ...DISCRETO,
          icon: '🔥',
          description: `Ouça ${e.metaMin} min por dia e veja sua sequência crescer.`,
        });
      } else if (e.sequencia > 0 && hoje) {
        toast(`🔥 ${dias(e.sequencia)}`, {
          ...DISCRETO,
          description: 'Meta de hoje batida. Bom te ver!',
        });
      } else if (e.sequencia > 0) {
        toast(`Bem-vindo de volta! 🔥 ${dias(e.sequencia)}`, {
          ...DISCRETO,
          description: `Faltam ${faltaHoje(e)} min hoje para manter.`,
        });
      } else {
        toast('Bem-vindo de volta!', {
          ...DISCRETO,
          icon: '🔥',
          description: `Ouça ${e.metaMin} min hoje e comece uma sequência.`,
        });
      }
      window.setTimeout(lembreteDoFimDoDia, 6_000);
    });
  }, []);

  // O lembrete também vale para quem volta ao app já aberto, à noite.
  useEffect(() => {
    const aoVoltar = (): void => {
      if (!document.hidden) lembreteDoFimDoDia();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, []);

  useEffect(() => {
    const parar = jornada.aoAcontecer((ev) => {
      if (ev.tipo === 'meta') {
        toast(`Meta do dia batida! 🔥 ${dias(ev.sequencia)}`, {
          ...DISCRETO,
          description: '+20 XP',
        });
      } else if (ev.tipo === 'protetor-ganho') {
        toast('Você ganhou um protetor 🛡️', {
          ...DISCRETO,
          description: 'Se um dia passar sem música, ele segura sua sequência.',
        });
      } else if (ev.tipo === 'protegeu') {
        toast('🛡️ Um protetor salvou sua sequência', {
          ...DISCRETO,
          description:
            ev.dias === 1
              ? 'Ontem passou sem música, mas a chama continua.'
              : `${ev.dias} dias cobertos.`,
        });
      }
    });
    const pararLiga = aoChegarJornada((j) => {
      if (!j.mudouDeLiga) return;
      const liga = LIGAS[j.liga]!;
      toast(
        j.mudouDeLiga === 'subiu'
          ? `Você subiu para a Liga ${liga.nome}!`
          : `Você caiu para a Liga ${liga.nome}`,
        { ...DISCRETO, icon: liga.icone, description: 'Nova semana, nova disputa.' },
      );
    });
    return () => {
      parar();
      pararLiga();
    };
  }, []);

  return null;
}
