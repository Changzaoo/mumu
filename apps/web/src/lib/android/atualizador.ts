/**
 * O APP DE ANDROID SE ATUALIZA SOZINHO (ver AtualizadorPlugin.java).
 *
 * Saiu APK novo → o app baixa em segundo plano e, quando a pessoa SAI do app
 * sem música tocando, entrega o arquivo ao instalador. No Android 12+ isso
 * acontece sem tela de confirmação; na próxima abertura o app já é o novo.
 *
 * A instalação fecha o app — por isso nunca é disparada com ele na frente (a
 * não ser pelo toque em "Atualizar") nem com música tocando.
 *
 * Na PRIMEIRA vez o Android exige que a pessoa libere "instalar apps
 * desconhecidos" para o radinho: até lá, quem resolve é o botão da barra.
 * APK anterior a este plugin: nada aqui funciona e a barra baixa pelo navegador.
 */
import { urlDoApk } from '@/lib/android/conviteApk';
import { usePlayerStore } from '@/stores/playerStore';

interface Atualizador {
  estado(): Promise<{
    podeInstalar: boolean;
    baixado: number;
    instalada: number;
    semToque: boolean;
  }>;
  pedirPermissao(): Promise<void>;
  baixar(opcoes: { url: string }): Promise<{ versao: number }>;
  instalar(): Promise<void>;
}

export function atualizadorNativo(): Atualizador | null {
  if (typeof window === 'undefined') return null;
  const cap = (
    window as Window & {
      Capacitor?: { isNativePlatform?: () => boolean; Plugins?: { Atualizador?: Atualizador } };
    }
  ).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return cap.Plugins?.Atualizador ?? null;
}

/** Garante o APK `publicada` baixado no aparelho. */
async function garantirBaixado(nativo: Atualizador, publicada: number): Promise<void> {
  const { baixado } = await nativo.estado();
  if (baixado >= publicada) return;
  await nativo.baixar({ url: urlDoApk() });
}

export type ResultadoDoToque = 'instalando' | 'pedir-permissao' | 'sem-plugin';

/**
 * O toque em "Atualizar". Sem a permissão do Android, abre a tela dela (a
 * pessoa liga e volta); com ela, baixa o que faltar e instala.
 */
export async function atualizarAgora(publicada: number): Promise<ResultadoDoToque> {
  const nativo = atualizadorNativo();
  if (!nativo) return 'sem-plugin';
  if (!(await nativo.estado()).podeInstalar) {
    await nativo.pedirPermissao();
    return 'pedir-permissao';
  }
  await garantirBaixado(nativo, publicada);
  await nativo.instalar();
  return 'instalando';
}

let armado = false;

/**
 * Atualização silenciosa: baixa já e instala quando o app for para o segundo
 * plano sem música. Só para quem já liberou a permissão — sem ela, nada de
 * gastar banda com um arquivo que não vai poder instalar.
 */
export async function armarAtualizacaoAutomatica(publicada: number): Promise<void> {
  const nativo = atualizadorNativo();
  if (!nativo || armado) return;
  armado = true;
  try {
    if (!(await nativo.estado()).podeInstalar) return;
    await garantirBaixado(nativo, publicada);
  } catch {
    armado = false; // rede caiu: a próxima abertura tenta de novo
    return;
  }
  const aoEsconder = (): void => {
    if (document.visibilityState !== 'hidden') return;
    if (usePlayerStore.getState().isPlaying) return;
    document.removeEventListener('visibilitychange', aoEsconder);
    void nativo.instalar().catch(() => {
      // Recusado (permissão retirada, arquivo apagado): a barra continua lá.
      armado = false;
    });
  };
  document.addEventListener('visibilitychange', aoEsconder);
}
