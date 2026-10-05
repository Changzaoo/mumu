/**
 * CONVITE PARA O APP DE ANDROID.
 *
 * Quem abre o radinho pelo site/PWA do Android vê uma barra FIXA com o botão
 * "Instalar" (ConviteApkBar): o APK é servido pelo próprio site
 * (`public/radinho.apk`), assinado sempre com a mesma chave — é o que deixa a
 * versão nova instalar por cima da antiga sem perder nada.
 *
 * Só aparece para quem pode usar: Android, fora do app nativo. Não há "agora
 * não" nem silêncio: a barra é estática e reaparece a cada abertura.
 */
import { toast } from 'sonner';
import { pushNotification } from '@/stores/notificationsStore';

export const APK_URL =
  (import.meta.env.VITE_ANDROID_APK_URL as string | undefined) || '/radinho.apk';

export function deveConvidar(opcoes: { userAgent: string; nativo: boolean }): boolean {
  if (opcoes.nativo) return false;
  if (!/Android/i.test(opcoes.userAgent)) return false;
  // Quest/TV/Chromebook dizem "Android" mas não instalam APK por aqui.
  if (/OculusBrowser|SmartTV|\bTV\b|CrOS/i.test(opcoes.userAgent)) return false;
  return true;
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
    /* sem storage: no pior caso o aviso volta na próxima abertura */
  }
}

export function ehNativo(): boolean {
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/** O convite vale para ESTE navegador? Lido uma vez, na montagem da barra. */
export function conviteAtivo(): boolean {
  if (typeof window === 'undefined') return false;
  return deveConvidar({ userAgent: navigator.userAgent, nativo: ehNativo() });
}

/** Versão NATIVA do app instalado ("RadinhoApp/N" no user-agent), ou null fora do app. */
export function versaoDoApp(userAgent: string): number | null {
  const m = /RadinhoApp\/(\d+)/.exec(userAgent);
  return m ? Number(m[1]) : null;
}

/**
 * APP DESATUALIZADO? O site sempre vem novo (o app abre radinho.online), mas o
 * que é NATIVO — barra de status, downloads, permissões — só muda com APK novo.
 * `radinho-apk.json` diz a versão do APK publicado; se for maior que a deste
 * app, avisa uma vez por versão.
 */
export async function avisarAtualizacaoDoApp(): Promise<void> {
  if (typeof window === 'undefined') return;
  const instalada = versaoDoApp(navigator.userAgent);
  if (instalada === null) return;
  let publicada = 0;
  try {
    const r = await fetch('/radinho-apk.json', { cache: 'no-store' });
    if (r.ok) publicada = Number(((await r.json()) as { versionCode?: number }).versionCode) || 0;
  } catch {
    return;
  }
  if (publicada <= instalada) return;
  const chave = `aurial:apk-avisado-${publicada}`;
  if (ler(chave)) return;
  gravar(chave, '1');
  pushNotification({
    type: 'update',
    title: 'Nova versão do app',
    body: 'Baixe e instale por cima: nada do que você salvou se perde.',
  });
  toast('Nova versão do radinho para Android', {
    description: 'Instale por cima da atual — suas músicas e ajustes continuam.',
    duration: Infinity,
    action: {
      label: 'Baixar',
      // O app entrega o download ao navegador do sistema (MainActivity).
      onClick: () => {
        window.location.href = new URL(APK_URL, window.location.origin).toString();
      },
    },
  });
}
