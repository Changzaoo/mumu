/**
 * OS LINKS COLADOS MORAM NA CONTA — e o servidor termina o que o app não
 * terminou.
 *
 * A fila de import (`importQueue`) baixa pelo aparelho, e sobrevive a fechar a
 * aba (retoma no próximo boot). Mas se a pessoa cola uma playlist e fecha o
 * navegador — ou o celular mata o app —, nada mais anda até ela voltar. Então
 * cada link também vira um registro na coleção `importacoes` da conta: o
 * aparelho o marca "feito" quando termina; o que ficar "pendente" por alguns
 * minutos o servidor pega e conclui (apps/api/src/workers/importacoes.worker.ts)
 * — baixa para o cofre e põe na biblioteca, que a sincronia traz para todos
 * os aparelhos.
 */
import { idDaImportacao, type EstadoDaImportacao, type ImportacaoNaConta } from '@radinho/shared';
import { serverCollection } from '@/lib/sync/serverCollection';

const conhecidos = new Map<string, ImportacaoNaConta>();

const nuvem = serverCollection<ImportacaoNaConta>({
  // 'importacoes' precisa estar na lista fechada de
  // apps/api/src/modules/collections/collections.controller.ts.
  name: 'importacoes',
  localItems: () => [],
  onRemoteUpsert: (id, data) => {
    conhecidos.set(id, data);
  },
  onRemoteDelete: (id) => {
    conhecidos.delete(id);
  },
});

export const setUser = nuvem.setUser;

/** Um link acabou de ser colado (ou saiu de uma playlist). */
export function registrar(url: string, forcePlaylist = false): void {
  const id = idDaImportacao(url);
  const atual = conhecidos.get(id);
  // Já feito (por este ou outro aparelho, ou pelo servidor): não reabre.
  if (atual && atual.estado !== 'erro') return;
  const agora = new Date().toISOString();
  const item: ImportacaoNaConta = {
    url: url.trim(),
    ...(forcePlaylist ? { forcePlaylist: true } : {}),
    estado: 'pendente',
    criadoEm: agora,
    atualizadoEm: agora,
  };
  conhecidos.set(id, item);
  nuvem.push(id, item);
}

/**
 * O aparelho está TRABALHANDO neste link agora — adia a carência do servidor.
 *
 * Sem isto, `atualizadoEm` fica parado no instante em que o link foi colado.
 * Numa fila ocupada (playlist grande, poucas vagas de download por vez — ver
 * `importQueue`) um item pode continuar "pendente" por mais de 8 minutos SÓ
 * ESPERANDO a vez, sem ninguém ter desistido dele. O worker do servidor
 * (`CARENCIA_MIN` em importacoes.worker.ts) não distingue "esperando" de
 * "abandonado" e baixa a MESMA faixa de novo, com outro id — duplicata na
 * biblioteca. Chamado quando o item começa a baixar, e de novo em intervalos
 * enquanto durar (arquivo grande, rede lenta), para o registro nunca
 * envelhecer 8 minutos enquanto o aparelho ainda está nele.
 */
export function tocar(url: string): void {
  const id = idDaImportacao(url);
  const atual = conhecidos.get(id);
  // Só adia o que ainda é NOSSO trabalho em aberto; nunca ressuscita um link já
  // fechado (feito/erro/expandida) por engano.
  if (!atual || atual.estado !== 'pendente') return;
  const item: ImportacaoNaConta = { ...atual, atualizadoEm: new Date().toISOString() };
  conhecidos.set(id, item);
  nuvem.push(id, item);
}

/** O aparelho terminou (ou desistiu de) um link. */
export function marcar(url: string, estado: EstadoDaImportacao, titulo?: string): void {
  const id = idDaImportacao(url);
  const agora = new Date().toISOString();
  const atual = conhecidos.get(id);
  const item: ImportacaoNaConta = {
    ...(atual ?? { url: url.trim(), criadoEm: agora }),
    estado,
    atualizadoEm: agora,
    ...(titulo ? { titulo } : {}),
  };
  conhecidos.set(id, item);
  nuvem.push(id, item);
}
