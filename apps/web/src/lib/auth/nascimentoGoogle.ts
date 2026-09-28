/**
 * MÊS E ANO DE NASCIMENTO VINDOS DA CONTA GOOGLE.
 *
 * A pergunta manual ("mês" e "ano" em dois seletores dentro de um diálogo)
 * travava no celular e ninguém gosta de responder. A conta Google já tem a
 * data: com o escopo `user.birthday.read` a People API a entrega.
 *
 * Só MÊS e ANO saem daqui — o dia é descartado na hora (a faixa etária não
 * precisa dele, e é menos dado pessoal guardado). Sem ano na conta (a pessoa
 * escondeu ou nunca informou), devolve null e a pergunta manual segue valendo.
 */
import { julgarLetrasGuardadas, podeTrocarPara } from '@/lib/conteudo/faixaEtaria';
import { useSettingsStore } from '@/stores/settingsStore';

interface DataGoogle {
  year?: number;
  month?: number;
  day?: number;
}
interface AniversarioGoogle {
  date?: DataGoogle;
  metadata?: { primary?: boolean; source?: { type?: string } };
}
interface RespostaPeople {
  birthdays?: AniversarioGoogle[];
}

const peso = (x: AniversarioGoogle): number =>
  (x.metadata?.source?.type === 'ACCOUNT' ? 2 : 0) + (x.metadata?.primary ? 1 : 0);

/** "AAAA-MM" a partir da resposta da People API, ou null. */
export function anoMesDaResposta(resposta: RespostaPeople): string | null {
  const datas = (resposta.birthdays ?? [])
    .filter((b) => b.date?.year && b.date.month)
    // A data da CONTA (a que o Google usa para idade) vence a de um contato.
    .sort((a, b) => peso(b) - peso(a));
  const d = datas[0]?.date;
  if (!d?.year || !d.month) return null;
  const agora = new Date().getFullYear();
  if (d.year < agora - 120 || d.year > agora || d.month < 1 || d.month > 12) return null;
  return `${d.year}-${String(d.month).padStart(2, '0')}`;
}

export async function lerNascimentoDoGoogle(accessToken: string): Promise<string | null> {
  const r = await fetch('https://people.googleapis.com/v1/people/me?personFields=birthdays', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return anoMesDaResposta((await r.json()) as RespostaPeople);
}

/**
 * Grava a data vinda do Google, respeitando a mesma trava da pergunta manual
 * (quem está numa faixa restrita não "envelhece" sozinho). Devolve se gravou.
 */
export function aplicarNascimento(valor: string): boolean {
  const { dataNascimento, setDataNascimento } = useSettingsStore.getState();
  if (dataNascimento === valor) return true;
  if (!podeTrocarPara(dataNascimento, valor)) return false;
  setDataNascimento(valor);
  void julgarLetrasGuardadas();
  return true;
}

/** Depois do login: preenche sozinho se ainda não sabemos a idade. Nunca lança. */
export async function preencherNascimentoDoLogin(accessToken: string | null): Promise<void> {
  if (!accessToken || useSettingsStore.getState().dataNascimento) return;
  try {
    const valor = await lerNascimentoDoGoogle(accessToken);
    if (valor) aplicarNascimento(valor);
  } catch {
    /* sem rede ou API desligada: a pergunta manual cobre */
  }
}
