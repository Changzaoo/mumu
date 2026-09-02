/**
 * Liga o ACERVO DO APP.
 *
 * Duas direções, as duas movidas pelo MESMO snapshot — o que a assinatura já
 * trouxe, sem custar leitura extra:
 *
 *   acervo → aparelho : as faixas entram na biblioteca local de quem escuta
 *   aparelho → acervo : o que está na minha biblioteca e falta no acervo sobe
 *
 * A segunda direção existe porque a versão anterior dependia de uma marca local
 * de "já publiquei isto". Marca de cliente mente: um deslize e o aparelho passa
 * a acreditar que publicou algo que nunca saiu, e nunca mais tenta. O acervo
 * ficou vazio exatamente assim. Comparando contra o snapshot real, toda
 * abertura do app corrige o que estiver faltando — sem botão, sem migração,
 * sem confiar em memória nenhuma.
 *
 * Mora separado de `catalogo.ts` porque aquele é importado pela biblioteca
 * local (caminho crítico do boot) e este puxa a biblioteca de volta — juntos,
 * fariam um ciclo de import.
 */
import { aplicarCatalogo, hydrate, list, registroPronto } from '@/lib/local/localLibrary';
import { reconciliarAcervo, subscribeCatalogo } from '@/lib/sync/catalogo';

let iniciado = false;

export function initCatalogo(): void {
  if (iniciado || typeof window === 'undefined') return;
  iniciado = true;

  // Sem depender de login: visitante também ouve o acervo (a prévia de 30s
  // continua valendo para ele).
  subscribeCatalogo((entradas) => {
    void (async () => {
      // ESPERA A TRAVA DO REGISTRO, NÃO A HIDRATAÇÃO INTEIRA.
      //
      // O que protege esta escrita é só uma coisa: o registro já ter vindo do
      // disco, senão o acervo grava por cima de uma biblioteca pela metade.
      // Esperar `hydrate()` completo punha o acervo atrás da restauração de
      // capas — até 150 imagens por abertura, em lotes que devolvem a vez para
      // a tela entre um e outro. A atualização do acervo chegava segundos
      // depois da lista, e a lista mudava de tamanho na cara de quem olhava.
      void hydrate(); // idempotente: garante que a trava vai cair, sem esperá-la
      await registroPronto();
      aplicarCatalogo(entradas);

      // Só quem PODE escrever consegue completar o acervo; para o ouvinte
      // comum a tentativa é recusada pela regra e para por aí. Por isso a
      // reconciliação só olha o que é do próprio aparelho.
      const idsNoAcervo = new Set(entradas.map((e) => e.track.id));
      const minhas = list().filter((e) => e.origem !== 'catalogo');
      await reconciliarAcervo(minhas, idsNoAcervo);
    })().catch(() => undefined);
  });
}
