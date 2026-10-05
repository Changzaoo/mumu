import { useEffect, useState } from 'react';
import { APK_URL, appDesatualizado, conviteAtivo, urlDoApk } from '@/lib/android/conviteApk';

/**
 * Barra FIXA do app de Android, em dois papéis:
 *
 *  - no navegador/PWA do Android: "Instalar" (nunca no iOS ou desktop);
 *  - DENTRO do app instalado, quando saiu APK mais novo: "Atualizar".
 *
 * Não tem como fechar: reaparece a cada abertura, e a de atualizar só some
 * quando a versão nova é instalada.
 *
 * Estática de propósito: é uma linha do layout (não `fixed`), então não cobre
 * mini player, abas nem o player expandido. Sem timer, sem listener, sem
 * animação — a de atualizar faz uma única consulta ao `radinho-apk.json`.
 */
export function ConviteApkBar() {
  const [convite] = useState(conviteAtivo);
  const [desatualizado, setDesatualizado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void appDesatualizado().then((sim) => {
      if (vivo && sim) setDesatualizado(true);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (desatualizado) {
    return (
      <Barra
        rotulo="Atualizar o app de Android"
        texto="Saiu versão nova do radinho. Instale por cima: nada se perde."
        botao="Atualizar"
        href={urlDoApk()}
      />
    );
  }
  if (!convite) return null;
  return (
    <Barra
      rotulo="Instalar o app de Android"
      texto="Instale o radinho no Android: toca com a tela apagada."
      botao="Instalar"
      href={APK_URL}
      soCelular
    />
  );
}

function Barra(props: {
  rotulo: string;
  texto: string;
  botao: string;
  href: string;
  soCelular?: boolean;
}) {
  return (
    <aside
      aria-label={props.rotulo}
      className={`flex shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-4 pt-[env(safe-area-inset-top)]${props.soCelular ? ' md:hidden' : ''}`}
    >
      <p className="min-w-0 flex-1 text-sm leading-tight text-fg">{props.texto}</p>
      <a
        href={props.href}
        download
        className="my-1 inline-flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg"
      >
        {props.botao}
      </a>
    </aside>
  );
}
