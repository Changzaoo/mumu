/**
 * O MENU QUE NÃO RESPONDE — flagrado no aparelho, e destravado na hora.
 *
 * O relato: "depois de um tempo o menu simplesmente congela". Só com a música
 * tocando, em todo aparelho (PC, celular, APK). Tocar numa aba não faz nada —
 * a aba nem acende —, mas o mini player continua abrindo a tela cheia. Ou
 * seja: a página está viva, o PLAYER responde, e só a NAVEGAÇÃO morreu.
 *
 * Não foi reproduzido na bancada (2026-10-12: rotas, menu "Mais", player,
 * letra, voltar, recarga automática e chunk que não chega — tudo navegou). Em
 * vez de um conserto no escuro, duas coisas que valem QUALQUER que seja a causa:
 *
 *  1. O FLAGRANTE vai para o diário de bordo (e dali para a telemetria):
 *     - `menu-coberto`: o toque caiu em OUTRO elemento por cima do link — e o
 *       diário diz qual (é o caso de uma camada invisível esquecida na tela);
 *     - `menu-sem-efeito`: o toque chegou ao link, mas a tela não trocou — e o
 *       diário diz em que estado o router ficou (navegação presa numa
 *       transição que nunca termina, por exemplo).
 *
 *  2. A SAÍDA: quem toca no menu não fica preso. O toque coberto é entregue ao
 *     router mesmo assim; a navegação que não pega em 1,5 s é pedida de novo;
 *     e se nem assim a tela trocar, o app recarrega JÁ na tela pedida, com a
 *     música voltando de onde estava (o mesmo cuidado de `lib/recarregar`).
 *
 * "A tela trocou" é medido pelo que o React DESENHOU (`data-rota` no <html>,
 * escrito pela casca a cada rota pintada), não pela URL: numa transição presa
 * a URL já mudou e a tela não — é justamente o caso que se quer pegar.
 */
import { anotar } from '@/lib/telemetry/diario';
import { prepararRetomadaTocando, usePlayerStore } from '@/stores/playerStore';
import { guardarTelaParaRecarregar } from '@/stores/uiStore';

/** O pedaço do router que isto usa — sem importar o router (evita ciclo). */
export interface RouterMinimo {
  navigate: (destino: string) => unknown;
  state: { navigation: { state: string }; location: { pathname: string } };
}

/** Quanto esperar a tela trocar antes de considerar o toque perdido. */
export const ESPERA_MS = 1_500;
/** Recarga de emergência no máximo uma vez por este intervalo (sem laço). */
const RECARGA_MIN_MS = 30_000;
const CHAVE_RECARGA = 'aurial:menu-travado-recarga';

/** Links da moldura: menu lateral, abas de baixo, folha "Mais". */
const SELETOR = 'nav a[href], aside a[href], [role="dialog"] a[href]';

/** A rota que o React de fato pintou (ver `marcarRotaPintada`). */
export function rotaPintada(): string {
  return document.documentElement.dataset.rota ?? '';
}

/** Chamado pela casca a cada rota pintada. */
export function marcarRotaPintada(rota: string): void {
  document.documentElement.dataset.rota = rota;
}

/** Caminho + busca de um link interno, ou `null` (externo, nova aba, âncora). */
export function destinoDoLink(a: HTMLAnchorElement, origem = location.origin): string | null {
  if (a.target && a.target !== '_self') return null;
  if (a.hasAttribute('download')) return null;
  let u: URL;
  try {
    u = new URL(a.getAttribute('href') ?? '', location.href);
  } catch {
    return null;
  }
  if (u.origin !== origem) return null;
  return `${u.pathname}${u.search}`;
}

function linkDaMoldura(el: Element | null): HTMLAnchorElement | null {
  const a = el?.closest?.(SELETOR);
  return a instanceof HTMLAnchorElement ? a : null;
}

/** Uma etiqueta curta do elemento, para o diário. */
export function descrever(el: Element | null): string {
  if (!el) return 'nada';
  let s = el.tagName.toLowerCase();
  if (el.id) s += `#${el.id}`;
  const rotulo = el.getAttribute('aria-label') ?? el.getAttribute('role');
  if (rotulo) s += `[${rotulo.slice(0, 30)}]`;
  const classe = typeof el.className === 'string' ? el.className.trim() : '';
  if (classe) s += `.${classe.split(/\s+/).slice(0, 4).join('.')}`;
  return s.slice(0, 120);
}

function contexto(router: RouterMinimo): string {
  const dialogos = document.querySelectorAll(
    '[role="dialog"],[role="alertdialog"],[role="menu"]',
  ).length;
  const corpo = document.body.getAttribute('style') ?? '';
  return [
    `router=${router.state.navigation.state} em ${router.state.location.pathname}`,
    `pintada=${rotaPintada()}`,
    `url=${location.pathname}`,
    dialogos ? `dialogos=${dialogos}` : '',
    corpo ? `body="${corpo.slice(0, 60)}"` : '',
    usePlayerStore.getState().isPlaying ? 'tocando' : 'parado',
  ]
    .filter(Boolean)
    .join(' · ');
}

function recarregarEm(destino: string): void {
  try {
    const ultima = Number(sessionStorage.getItem(CHAVE_RECARGA) ?? 0);
    if (Date.now() - ultima < RECARGA_MIN_MS) return;
    sessionStorage.setItem(CHAVE_RECARGA, String(Date.now()));
  } catch {
    /* sem sessionStorage: ainda assim destrava */
  }
  if (usePlayerStore.getState().isPlaying) prepararRetomadaTocando();
  guardarTelaParaRecarregar();
  window.location.assign(destino);
}

/** Há um diálogo/menu aberto DE VERDADE (visível)? Tocar fora dele o fecha. */
function haCamadaAberta(): boolean {
  return Array.from(
    document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"]'),
  ).some((d) => d.getAttribute('data-state') !== 'closed' && d.getClientRects().length > 0);
}

/**
 * Depois de `ESPERA_MS`: a tela foi para `destino`? Se continua em `antes`, o
 * toque se perdeu — anota e destrava. Se foi para um terceiro lugar, a pessoa
 * seguiu adiante (outro toque, voltar) e não há o que fazer.
 */
function vigiar(router: RouterMinimo, destino: string, antes: string): void {
  const perdido = (): boolean => !document.hidden && rotaPintada() === antes;
  window.setTimeout(() => {
    if (!perdido()) return;
    anotar('erro', 'menu-sem-efeito', `${destino} · ${contexto(router)}`);
    void Promise.resolve(router.navigate(destino)).catch(() => undefined);
    window.setTimeout(() => {
      if (!perdido()) return;
      anotar('erro', 'menu-recarga', `${destino} · ${contexto(router)}`);
      recarregarEm(destino);
    }, ESPERA_MS);
  }, ESPERA_MS);
}

let instalado = false;

export function instalarVigiaDoMenu(router: RouterMinimo): void {
  if (instalado || typeof document === 'undefined') return;
  instalado = true;
  document.addEventListener(
    'click',
    (ev: MouseEvent) => {
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const antes = rotaPintada();
      // Fora da casca (login, onboarding) não há rota pintada para comparar.
      if (!antes) return;
      let link = linkDaMoldura(ev.target as Element | null);
      if (!link && !haCamadaAberta()) {
        // O `body` preso em `pointer-events: none` sem diálogo nenhum aberto é
        // a página inteira surda — a sobra de um modal que fechou mal. Solta.
        if (document.body.style.pointerEvents === 'none') {
          anotar(
            'erro',
            'menu-coberto',
            `body pointer-events:none sem diálogo · ${contexto(router)}`,
          );
          document.body.style.pointerEvents = '';
        }
        // O toque caiu fora de um link — mas havia um link EMBAIXO do dedo?
        if (typeof document.elementsFromPoint === 'function') {
          const pilha = document.elementsFromPoint(ev.clientX, ev.clientY);
          const abaixo = pilha.map(linkDaMoldura).find((a): a is HTMLAnchorElement => a !== null);
          const destinoAbaixo = abaixo ? destinoDoLink(abaixo) : null;
          if (abaixo && destinoAbaixo && destinoAbaixo !== antes) {
            anotar(
              'erro',
              'menu-coberto',
              `${destinoAbaixo} sob ${descrever(pilha[0] ?? null)} · ${contexto(router)}`,
            );
            void Promise.resolve(router.navigate(destinoAbaixo)).catch(() => undefined);
            link = abaixo;
          }
        }
      }
      if (!link) return;
      const destino = destinoDoLink(link);
      if (!destino || destino === antes) return;
      vigiar(router, destino, antes);
    },
    { capture: true },
  );
}
