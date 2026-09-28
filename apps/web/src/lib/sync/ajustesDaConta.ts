/**
 * AJUSTES QUE VALEM PARA A CONTA — não para o aparelho.
 *
 * O interruptor do agente pesquisador vivia só no localStorage do navegador em
 * que foi ligado: ligado no computador, aparecia desligado no celular (a
 * telemetria mostrava cada aparelho com ajustes próprios), e o Safari do iPhone
 * ainda apaga o armazenamento de sites que passam dias sem uso — "nunca fica
 * ligado". E o agente de verdade roda no SERVIDOR, 24/7: ele precisa saber da
 * escolha sem nenhum aparelho aberto.
 *
 * Então a escolha mora na conta (`User.settings.pesquisadorAtivo`): ao entrar,
 * o app lê de lá; mudar aqui manda para lá. Quem já tinha ligado neste
 * aparelho antes disto existir tem a escolha levada para a conta uma vez.
 */
import type { MeDto } from '@radinho/shared';
import { api } from '@/lib/api';
import { subscribeAuth } from '@/lib/firebase';
import { useSettingsStore } from '@/stores/settingsStore';

let logado = false;
let aplicandoDaConta = false;

function enviar(settings: { pesquisadorAtivo?: boolean; dataNascimento?: string | null }): void {
  void api.patch<MeDto>('/me', { settings }).catch(() => undefined);
}

export function initAjustesDaConta(): () => void {
  const pararAuth = subscribeAuth((user) => {
    logado = Boolean(user && !user.isAnonymous);
    if (!logado) return;
    void api
      .get<MeDto>('/me')
      .then(({ data }) => {
        const daConta = data.settings?.pesquisadorAtivo;
        const local = useSettingsStore.getState();
        aplicandoDaConta = true;
        if (typeof daConta === 'boolean') local.setPesquisadorAtivo(daConta);
        // A IDADE da conta vale para todos os aparelhos; se a conta ainda não
        // sabe e este aparelho sabe, leva para lá.
        const nascimento = data.settings?.dataNascimento;
        if (typeof nascimento === 'string') local.setDataNascimento(nascimento);
        aplicandoDaConta = false;
        if (typeof daConta !== 'boolean' && local.pesquisadorAtivo) {
          enviar({ pesquisadorAtivo: true }); // ligado aqui antes de a conta guardar
        }
        if (typeof nascimento !== 'string' && local.dataNascimento) {
          enviar({ dataNascimento: local.dataNascimento });
        }
      })
      .catch(() => undefined);
  });
  const pararAjustes = useSettingsStore.subscribe((s, antes) => {
    if (aplicandoDaConta || !logado) return;
    if (s.pesquisadorAtivo !== antes.pesquisadorAtivo)
      enviar({ pesquisadorAtivo: s.pesquisadorAtivo });
    if (s.dataNascimento !== antes.dataNascimento) enviar({ dataNascimento: s.dataNascimento });
  });
  return () => {
    pararAuth();
    pararAjustes();
  };
}
