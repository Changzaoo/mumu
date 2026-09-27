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

function enviar(pesquisadorAtivo: boolean): void {
  void api.patch<MeDto>('/me', { settings: { pesquisadorAtivo } }).catch(() => undefined);
}

export function initAjustesDaConta(): () => void {
  const pararAuth = subscribeAuth((user) => {
    logado = Boolean(user && !user.isAnonymous);
    if (!logado) return;
    void api
      .get<MeDto>('/me')
      .then(({ data }) => {
        const daConta = data.settings?.pesquisadorAtivo;
        if (typeof daConta === 'boolean') {
          aplicandoDaConta = true;
          useSettingsStore.getState().setPesquisadorAtivo(daConta);
          aplicandoDaConta = false;
        } else if (useSettingsStore.getState().pesquisadorAtivo) {
          enviar(true); // ligado aqui antes de a conta guardar: leva para a conta
        }
      })
      .catch(() => undefined);
  });
  const pararAjustes = useSettingsStore.subscribe((s, antes) => {
    if (s.pesquisadorAtivo === antes.pesquisadorAtivo || aplicandoDaConta || !logado) return;
    enviar(s.pesquisadorAtivo);
  });
  return () => {
    pararAuth();
    pararAjustes();
  };
}
