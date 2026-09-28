/**
 * CONVITE PARA O APP DE ANDROID.
 *
 * Quem abre o radinho pelo navegador do Android ganha um aviso com o botão
 * "Baixar": o APK é servido pelo próprio site (`public/radinho.apk`),
 * assinado sempre com a mesma chave — é o que deixa a versão nova instalar por
 * cima da antiga sem perder nada.
 *
 * Só aparece para quem pode usar: Android, fora do app nativo. "Agora não"
 * silencia por 14 dias — um convite que volta toda abertura vira propaganda.
 * O sino guarda o aviso uma vez só, para quem fechou o toast sem ler.
 */
import { toast } from 'sonner';
import { pushNotification } from '@/stores/notificationsStore';

export const APK_URL =
  (import.meta.env.VITE_ANDROID_APK_URL as string | undefined) || '/radinho.apk';

const CHAVE_DISPENSADO = 'aurial:apk-dispensado-em';
const CHAVE_NO_SINO = 'aurial:apk-no-sino';
const SILENCIO_MS = 14 * 24 * 60 * 60 * 1000;

export function deveConvidar(opcoes: {
  userAgent: string;
  nativo: boolean;
  dispensadoEm: number | null;
  agora: number;
}): boolean {
  if (opcoes.nativo) return false;
  if (!/Android/i.test(opcoes.userAgent)) return false;
  // Quest/TV/Chromebook dizem "Android" mas não instalam APK por aqui.
  if (/OculusBrowser|SmartTV|\bTV\b|CrOS/i.test(opcoes.userAgent)) return false;
  return opcoes.dispensadoEm === null || opcoes.agora - opcoes.dispensadoEm > SILENCIO_MS;
}

function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): void {
  try {
    window.localStorage.setItem(chave, valor);
  } catch {
    /* sem storage: no pior caso o convite volta na próxima abertura */
  }
}

function ehNativo(): boolean {
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function convidarParaApk(): void {
  if (typeof window === 'undefined') return;
  const dispensado = Number(ler(CHAVE_DISPENSADO));
  if (
    !deveConvidar({
      userAgent: navigator.userAgent,
      nativo: ehNativo(),
      dispensadoEm: Number.isFinite(dispensado) && dispensado > 0 ? dispensado : null,
      agora: Date.now(),
    })
  ) {
    return;
  }

  if (!ler(CHAVE_NO_SINO)) {
    gravar(CHAVE_NO_SINO, '1');
    pushNotification({
      type: 'update',
      title: 'radinho para Android',
      body: `Instale o app: toca com a tela apagada e abre mais rápido. Baixe em ${APK_URL}`,
    });
  }

  toast('Instale o radinho no seu Android', {
    description:
      'Toca com a tela apagada e abre mais rápido. Se o Android pedir, permita instalar apps do navegador.',
    duration: Infinity,
    action: {
      label: 'Baixar',
      onClick: () => {
        gravar(CHAVE_DISPENSADO, String(Date.now()));
        window.location.href = APK_URL;
      },
    },
    cancel: {
      label: 'Agora não',
      onClick: () => gravar(CHAVE_DISPENSADO, String(Date.now())),
    },
  });
}
