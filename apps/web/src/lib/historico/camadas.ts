/**
 * GERENTE DE CAMADAS — o "voltar" fecha o que está POR CIMA da página.
 *
 * Player expandido, letra, fila, diálogos, folhas e menus não são rotas: abrir
 * um deles não mexia no histórico, então o botão voltar (do Android, do gesto,
 * do navegador) saía da PÁGINA — e, com o app aberto na raiz, da própria app —
 * em vez de só fechar a camada.
 *
 * COMO FUNCIONA (tudo no lado web; vale para navegador, PWA e para o APK):
 *
 *  - Cada camada aberta tem UMA entrada no histórico, empurrada com
 *    `history.pushState` ao abrir. A entrada é cópia de `history.state` (o
 *    react-router guarda `usr`/`key`/`idx` ali) mais um marcador `__camada`
 *    `{ d: profundidade, tipo, base: chave da página }`. Mesma URL, mesmo `idx`.
 *  - O `popstate` é escutado na fase de CAPTURA da janela, antes do
 *    react-router. Quando o evento é só "entrar/sair de uma camada" (mesma
 *    página), ele é consumido aqui (`stopImmediatePropagation`): o router nem
 *    fica sabendo, a rota não muda e a página de baixo não re-renderiza.
 *  - Fechar pela UI (X, arrastar, Esc, escolher item) é só a camada sair do
 *    ar: o gerente descobre que há entradas a mais e consome com `history.go`,
 *    sem entradas-fantasma e sem navegação dupla. Operações que dependem do
 *    histórico são SERIALIZADAS (`aguardando`): enquanto um `go` não chegou,
 *    nada é empurrado por cima — é o que evita a corrida "menu fecha e abre um
 *    diálogo no mesmo instante".
 *  - Entradas de camada são fungíveis (só contam profundidade): a lógica é
 *    sempre "quantas camadas há" × "em que profundidade o histórico está".
 *
 * Por que `history.state` e não `location.state`/rotas do router: navegar pelo
 * router para abrir uma camada re-renderizaria a árvore de rotas e dispararia
 * a remontagem/restauração de rolagem; com o marcador, o router nunca vê a
 * camada. O `idx`/`key` do router são preservados nas cópias, então os
 * pushes/POPs dele continuam coerentes.
 *
 * FANTASMAS. Se a rota muda com camada aberta (link dentro do player), as
 * entradas da camada ficam para trás no histórico (não dá para apagar entrada).
 * Quando o voltar chega nelas vindo de outra página, são puladas com mais um
 * `back()`; quando chega da mesma página (avançar), a camada é REABERTA se
 * houver um reabridor registrado (player, letra), ou o marcador é descartado.
 */
import { useCallback, useEffect, useRef, type Ref } from 'react';

const CHAVE = '__camada';

interface Marcador {
  d: number;
  tipo: string;
  base: string;
}

export interface Camada {
  id: number;
  tipo: string;
  /** Fecha a camada (mexe só na UI; nunca no histórico). */
  fechar: () => void;
  /** Ainda está aberta? Usado para detectar camada que se recusou a fechar. */
  aberta: () => boolean;
}

let proximoId = 1;
let camadas: Camada[] = [];
let aguardando = false;
let timerAguardo: ReturnType<typeof setTimeout> | null = null;
let paginaAtual: string | null = null;
const reabridores = new Map<string, () => void>();

/** Quanto esperar um `history.go` que nunca chega (já estava no começo, p.ex.). */
const AGUARDO_MAX_MS = 600;

function marcadorDe(estado: unknown): Marcador | null {
  if (!estado || typeof estado !== 'object') return null;
  const m = (estado as Record<string, unknown>)[CHAVE];
  if (!m || typeof m !== 'object') return null;
  const { d, tipo, base } = m as Record<string, unknown>;
  if (typeof d !== 'number' || typeof tipo !== 'string' || typeof base !== 'string') return null;
  return { d, tipo, base };
}

/** A chave do react-router para uma entrada (`default` na primeira, sem chave). */
function chaveDe(estado: unknown): string {
  const k = estado && typeof estado === 'object' ? (estado as { key?: unknown }).key : undefined;
  return typeof k === 'string' ? k : 'default';
}

function semMarcador(estado: unknown): Record<string, unknown> {
  const { [CHAVE]: _descartado, ...resto } = (estado ?? {}) as Record<string, unknown>;
  void _descartado;
  return resto;
}

function paginaVigente(): string {
  if (paginaAtual !== null) return paginaAtual;
  const m = marcadorDe(window.history.state);
  return m ? m.base : chaveDe(window.history.state);
}

/** Quem acompanha o router informa a página atual (`useLocation().key`). */
export function definirPaginaAtual(chave: string): void {
  paginaAtual = chave;
}

/** Registra como reabrir, pelo avançar do navegador, uma camada de `tipo`. */
export function registrarReabridor(tipo: string, reabrir: () => void): () => void {
  reabridores.set(tipo, reabrir);
  return () => {
    if (reabridores.get(tipo) === reabrir) reabridores.delete(tipo);
  };
}

function terminarAguardo(): void {
  aguardando = false;
  if (timerAguardo) clearTimeout(timerAguardo);
  timerAguardo = null;
}

/** Leva o histórico à profundidade igual ao número de camadas abertas. */
function sincronizar(): void {
  if (typeof window === 'undefined' || aguardando) return;
  const estado = window.history.state;
  const m = marcadorDe(estado);
  const prof = m?.d ?? 0;
  const n = camadas.length;
  // Sem o router avisando (testes, ou antes do primeiro render), a página de
  // baixo das camadas é a entrada atual enquanto ela não tem marcador.
  if (!m && paginaAtual === null) paginaAtual = chaveDe(estado);
  if (prof < n) {
    const base = m ? m.base : chaveDe(estado);
    for (let d = prof + 1; d <= n; d++) {
      const camada = camadas[d - 1];
      try {
        window.history.pushState(
          {
            ...semMarcador(window.history.state),
            [CHAVE]: { d, tipo: camada?.tipo ?? 'camada', base },
          },
          '',
        );
      } catch {
        return; // sem History API utilizável: a camada só não entra no histórico
      }
    }
  } else if (prof > n) {
    aguardando = true;
    timerAguardo = setTimeout(() => {
      terminarAguardo();
      sincronizar();
    }, AGUARDO_MAX_MS);
    window.history.go(-(prof - n));
  }
}

/** Camada que se recusou a fechar (diálogo não dispensável) volta à pilha. */
function conferirRecusa(c: Camada): void {
  setTimeout(() => {
    if (camadas.includes(c) || !c.aberta()) return;
    camadas.push(c);
    sincronizar();
  }, 0);
}

function fecharAte(d: number): void {
  while (camadas.length > d) {
    const c = camadas.pop();
    if (!c) break;
    try {
      c.fechar();
    } catch {
      /* fechar é melhor-esforço */
    }
    conferirRecusa(c);
  }
}

export function registrar(camada: Omit<Camada, 'id'>): Camada {
  const c: Camada = { ...camada, id: proximoId++ };
  camadas.push(c);
  sincronizar();
  return c;
}

export function desregistrar(c: Camada): void {
  const i = camadas.indexOf(c);
  if (i >= 0) camadas.splice(i, 1);
  sincronizar();
}

function aoPopState(ev: PopStateEvent): void {
  const estado = window.history.state;
  const m = marcadorDe(estado);
  const d = m?.d ?? 0;
  const n = camadas.length;

  // Chegada que nós mesmos pedimos (`history.go` do sincronizar).
  if (aguardando) {
    terminarAguardo();
    ev.stopImmediatePropagation();
    sincronizar();
    return;
  }

  const pagina = paginaVigente();

  if (m) {
    ev.stopImmediatePropagation();
    if (m.base !== pagina) {
      // Entrada-fantasma de uma página que ficou para trás: pula.
      window.history.back();
      return;
    }
    if (d < n) {
      fecharAte(d);
      sincronizar();
    } else if (d > n) {
      const reabrir = reabridores.get(m.tipo);
      if (reabrir) {
        reabrir();
        // Se a camada não se registrar (nada a reabrir), desce de volta.
        setTimeout(sincronizar, 150);
      } else {
        window.history.replaceState(semMarcador(estado), '');
      }
    }
    return;
  }

  // Sem marcador: ou é a página de baixo das camadas (voltou até ela), ou é
  // outra entrada do router (mudou de página).
  if (chaveDe(estado) === pagina) {
    ev.stopImmediatePropagation();
    fecharAte(0);
    return;
  }
  // Navegação de verdade (POP do router): as camadas deixam de fazer sentido.
  // Fecham-se sem mexer no histórico (já estamos em outra entrada) e o evento
  // segue para o router.
  paginaAtual = chaveDe(estado); // o router confirma em seguida
  const abertas = camadas;
  camadas = [];
  for (const c of abertas) {
    try {
      c.fechar();
    } catch {
      /* melhor-esforço */
    }
  }
}

let instalado = false;
/** Idempotente; chamado ao importar o módulo no navegador. */
export function instalarGerenteDeCamadas(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  // Captura: roda antes dos ouvintes do router (mesmo alvo, fase de captura vem
  // primeiro nos navegadores atuais).
  window.addEventListener('popstate', aoPopState, { capture: true });
  try {
    // A rolagem é nossa (ver useRolagemPorEntrada); o navegador não deve tentar.
    window.history.scrollRestoration = 'manual';
  } catch {
    /* ignora */
  }
}
instalarGerenteDeCamadas();

/** Só para testes: volta ao zero sem desinstalar o ouvinte. */
export function __reiniciarCamadas(): void {
  camadas = [];
  terminarAguardo();
  paginaAtual = null;
  reabridores.clear();
}

/**
 * Enquanto `aberta` for true, a camada tem uma entrada no histórico: o voltar
 * chama `fechar` (que deve só fechar a UI). `estaAberta` confirma o fechamento
 * (padrão: `aberta` do último render).
 */
export function useCamadaNoHistorico(
  aberta: boolean,
  fechar: () => void,
  tipo = 'camada',
  estaAberta?: () => boolean,
): void {
  const fecharRef = useRef(fechar);
  const abertaRef = useRef(aberta);
  const confirmarRef = useRef(estaAberta);
  useEffect(() => {
    fecharRef.current = fechar;
    abertaRef.current = aberta;
    confirmarRef.current = estaAberta;
  });
  useEffect(() => {
    if (!aberta) return;
    const c = registrar({
      tipo,
      fechar: () => fecharRef.current(),
      aberta: () => (confirmarRef.current ? confirmarRef.current() : abertaRef.current),
    });
    return () => desregistrar(c);
  }, [aberta, tipo]);
}

function apertarEsc(): void {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  );
}

/**
 * Para o conteúdo de componentes Radix (diálogo, folha, menu): o ELEMENTO de
 * conteúdo só existe enquanto aberto, então o ref dele marca abrir (nó) e
 * fechar (null). O componente-wrapper (`DialogContent`...) fica montado mesmo
 * fechado — por isso o registro NÃO pode ser um efeito dele.
 *
 * Fecha pelo mesmo caminho do Esc: o `DismissableLayer` do Radix fecha só a
 * camada do topo e respeita um `onEscapeKeyDown` que impeça o fechamento (a
 * camada então volta à pilha).
 *
 * Devolve o ref a pôr no elemento de conteúdo; compõe com o `ref` do chamador.
 */
export function useCamadaRadix<T extends HTMLElement>(
  refDoChamador?: Ref<T>,
): (node: T | null) => void {
  const externoRef = useRef<Ref<T> | undefined>(refDoChamador);
  const camadaRef = useRef<Camada | null>(null);
  useEffect(() => {
    externoRef.current = refDoChamador;
  });
  // Saída do componente inteiro (a rota trocou, o diálogo foi desmontado sem
  // passar pelo ref nulo): garante a baixa.
  useEffect(
    () => () => {
      if (camadaRef.current) {
        desregistrar(camadaRef.current);
        camadaRef.current = null;
      }
    },
    [],
  );
  return useCallback((node: T | null) => {
    if (node && !camadaRef.current) {
      camadaRef.current = registrar({
        tipo: 'radix',
        fechar: apertarEsc,
        aberta: () => node.isConnected && node.getAttribute('data-state') !== 'closed',
      });
    } else if (!node && camadaRef.current) {
      desregistrar(camadaRef.current);
      camadaRef.current = null;
    }
    const ext = externoRef.current;
    if (typeof ext === 'function') ext(node);
    else if (ext) (ext as { current: T | null }).current = node;
  }, []);
}
