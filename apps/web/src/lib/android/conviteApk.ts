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
 * que é NATIVO — ícone, barra de status, downloads, permissões — só muda com
 * APK novo. `radinho-apk.json` diz a versão do APK publicado; se for maior que
 * a deste app, a barra fixa "Atualizar" (ConviteApkBar) aparece e fica até a
 * pessoa instalar. O Android não deixa um app de fora da loja se atualizar
 * sozinho: o máximo é levar ao download com um toque.
 */
export async function appDesatualizado(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const instalada = versaoDoApp(navigator.userAgent);
  if (instalada === null) return false;
  try {
    const r = await fetch('/radinho-apk.json', { cache: 'no-store' });
    if (!r.ok) return false;
    const publicada = Number(((await r.json()) as { versionCode?: number }).versionCode) || 0;
    return publicada > instalada;
  } catch {
    return false;
  }
}

/** Endereço completo do APK: dentro do app o download sai pelo navegador do sistema. */
export function urlDoApk(): string {
  return new URL(APK_URL, window.location.origin).toString();
}

/** Deixa também um registro no sino, uma vez por abertura, para quem não viu a barra. */
export async function avisarAtualizacaoDoApp(): Promise<void> {
  if (!(await appDesatualizado())) return;
  pushNotification({
    type: 'update',
    title: 'Nova versão do app',
    body: 'Baixe e instale por cima: nada do que você salvou se perde.',
  });
}
