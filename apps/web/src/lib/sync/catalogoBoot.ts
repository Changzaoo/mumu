/**
 * Liga o ACERVO DO APP: assina para todo mundo, e no aparelho do admin publica
 * o que já existia antes de o acervo existir.
 *
 * Mora separado de `catalogo.ts` porque aquele é importado pela biblioteca
 * local (caminho crítico do boot) e este puxa a biblioteca de volta — juntos,
 * fariam um ciclo de import.
 */
import { aplicarCatalogo, hydrate, list } from '@/lib/local/localLibrary';
import { publicarAcervoDoAdmin, subscribeCatalogo } from '@/lib/sync/catalogo';
import { subscribeAuth } from '@/lib/firebase';

let iniciado = false;

export function initCatalogo(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;

  // Assinatura única, sem depender de login: visitante também ouve o acervo
  // (a prévia de 30s continua valendo para ele).
  subscribeCatalogo((entradas) => {
    void hydrate().then(() => aplicarCatalogo(entradas));
  });

  // BACKFILL DO ADMIN. Sem isto o acervo nasceria só com o que for importado
  // DEPOIS desta versão: quem estivesse esperando as músicas continuaria sem
  // elas, e o conserto pareceria não ter funcionado. Só roda no aparelho do
  // admin (a própria função confere) e é idempotente.
  let publicado = false;
  subscribeAuth((user) => {
    if (!user || publicado) return;
    publicado = true;
    void hydrate()
      .then(() => publicarAcervoDoAdmin(list().filter((e) => e.origem !== 'catalogo')))
      .catch(() => undefined);
  });
}
