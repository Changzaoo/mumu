import { useState } from 'react';
import { APK_URL, conviteAtivo } from '@/lib/android/conviteApk';

/**
 * Barra FIXA para instalar o app de Android. Aparece só no Android pelo
 * navegador/PWA (nunca no app nativo, iOS ou desktop), em todas as telas, e
 * não tem como fechar: reaparece a cada abertura.
 *
 * Estática de propósito: é uma linha do layout (não `fixed`), então não cobre
 * mini player, abas nem o player expandido e não causa salto — nasce já no
 * primeiro render. Sem timer, sem listener, sem animação.
 */
export function ConviteApkBar() {
  const [ativo] = useState(conviteAtivo);
  if (!ativo) return null;
  return (
    <aside
      aria-label="Instalar o app de Android"
      className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-4 pt-[env(safe-area-inset-top)] md:hidden"
    >
      <p className="min-w-0 flex-1 text-sm leading-tight text-fg">
        Instale o radinho no Android: toca com a tela apagada.
      </p>
      <a
        href={APK_URL}
        download
        className="my-1 inline-flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg"
      >
        Instalar
      </a>
    </aside>
  );
}
