/**
 * Enumeração das rotas REGISTRADAS no app Express 5 (router 2.x).
 *
 * O Express 5 não guarda o texto do caminho de um `router.use('/x', sub)`, só
 * o matcher. Por isso o prefixo de cada sub-router é resolvido por IDENTIDADE
 * do objeto: a tabela `montagens` (rotas.montagens.ts) espelha `app.ts`, e uma
 * montagem desconhecida aparece em `desconhecidas` e derruba o teste — rota
 * nova sem cobertura não passa em silêncio.
 */
import type { Express } from 'express';

export interface RotaRegistrada {
  metodo: string; // GET, POST...
  caminho: string; // /api/v1/tracks/:id
  params: string[];
  /** nomes das funções do encadeamento, na ordem (requireAuth, multerMiddleware...) */
  pilha: string[];
}

interface Camada {
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Camada[] };
  handle: { stack?: Camada[]; name?: string };
  name?: string;
  matchers?: unknown[];
}

const CANDIDATOS_RAIZ = ['/api/v1', '/api/docs', '/media'];

/** Prefixo de um router de topo pelo matcher da camada (único jeito no Express 5). */
function sondar(camada: Camada): string | undefined {
  const m = camada.matchers?.[0] as ((p: string) => unknown) | undefined;
  if (!m) return undefined;
  return CANDIDATOS_RAIZ.find((c) => m(c + '/zz'));
}

export function enumerarRotas(
  app: Express,
  montagens: Map<unknown, string>,
): { rotas: RotaRegistrada[]; desconhecidas: string[] } {
  const rotas: RotaRegistrada[] = [];
  const desconhecidas: string[] = [];

  function caminhar(pilha: Camada[], prefixo: string, topo: boolean): void {
    // middlewares `router.use(mw)` valem para as rotas registradas DEPOIS deles
    const antes: string[] = [];
    for (const camada of pilha) {
      if (camada.route) {
        const caminhos = Array.isArray(camada.route.path) ? camada.route.path : [camada.route.path];
        for (const c of caminhos) {
          for (const metodo of Object.keys(camada.route.methods)) {
            if (!camada.route.methods[metodo]) continue;
            const completo = prefixo + (c === '/' ? '' : c) || '/';
            rotas.push({
              metodo: metodo.toUpperCase(),
              caminho: completo,
              params: [...completo.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string),
              pilha: [
                ...antes,
                ...camada.route.stack.map((s) => s.name || s.handle.name || 'anon'),
              ],
            });
          }
        }
      } else if (camada.handle.stack) {
        const sub = montagens.get(camada.handle) ?? (topo ? sondar(camada) : undefined);
        if (sub === undefined) {
          desconhecidas.push(`router sem prefixo conhecido (name=${camada.name})`);
          continue;
        }
        caminhar(camada.handle.stack, sub, false);
      } else if (!topo) {
        antes.push(camada.name || camada.handle.name || 'anon');
      }
    }
  }

  caminhar((app as unknown as { router: { stack: Camada[] } }).router.stack, '', true);
  return { rotas, desconhecidas };
}
