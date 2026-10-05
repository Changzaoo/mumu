import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  APK_URL,
  conviteAtivo,
  urlDoApk,
  versaoNovaDoApp,
  type VersaoNova,
} from '@/lib/android/conviteApk';
import {
  armarAtualizacaoAutomatica,
  atualizadorNativo,
  atualizarAgora,
} from '@/lib/android/atualizador';

/**
 * Barra FIXA do app de Android, em dois papéis:
 *
 *  - no navegador/PWA do Android: "Instalar" (nunca no iOS ou desktop);
 *  - DENTRO do app instalado, quando saiu APK mais novo: "Atualizar".
 *
 * Não tem como fechar: reaparece a cada abertura, e a de atualizar só some
 * quando a versão nova é instalada. No app que já tem o atualizador
 * (lib/android/atualizador.ts) o download e a instalação acontecem sozinhos
 * quando a pessoa sai do app; a barra é o caminho de quem quer agora.
 *
 * Estática de propósito: é uma linha do layout (não `fixed`), então não cobre
 * mini player, abas nem o player expandido. Sem timer, sem listener, sem
 * animação — a de atualizar faz uma única consulta ao `radinho-apk.json`.
 */
export function ConviteApkBar() {
  const [convite] = useState(conviteAtivo);
  const [nova, setNova] = useState<VersaoNova | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    void versaoNovaDoApp().then((v) => {
      if (!vivo || !v) return;
      setNova(v);
      void armarAtualizacaoAutomatica(v.publicada);
    });
    return () => {
      vivo = false;
    };
  }, []);

  if (nova) {
    const texto = `Saiu a versão ${nova.nome || nova.publicada} do radinho (a sua é a ${nova.instalada}). Nada do que você salvou se perde.`;
    // APK anterior ao atualizador: o download sai pelo navegador do sistema.
    if (!atualizadorNativo()) {
      return (
        <Barra rotulo="Atualizar o app de Android" texto={texto}>
          <a href={urlDoApk()} download className={BOTAO}>
            Atualizar
          </a>
        </Barra>
      );
    }
    const tocar = async (): Promise<void> => {
      setOcupado(true);
      try {
        if ((await atualizarAgora(nova.publicada)) === 'pedir-permissao') {
          toast('Ligue "Permitir desta fonte" e volte ao radinho', {
            description: 'É só na primeira vez: depois o app se atualiza sozinho.',
          });
        }
      } catch (erro) {
        toast.error(erro instanceof Error ? erro.message : 'Não deu para atualizar agora.');
      } finally {
        setOcupado(false);
      }
    };
    return (
      <Barra rotulo="Atualizar o app de Android" texto={texto}>
        <button type="button" onClick={() => void tocar()} disabled={ocupado} className={BOTAO}>
          {ocupado ? 'Baixando…' : 'Atualizar'}
        </button>
      </Barra>
    );
  }
  if (!convite) return null;
  return (
    <Barra
      rotulo="Instalar o app de Android"
      texto="Instale o radinho no Android: toca com a tela apagada."
      soCelular
    >
      <a href={APK_URL} download className={BOTAO}>
        Instalar
      </a>
    </Barra>
  );
}

const BOTAO =
  'my-1 inline-flex min-h-11 shrink-0 items-center rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg disabled:opacity-60';

function Barra(props: { rotulo: string; texto: string; soCelular?: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label={props.rotulo}
      className={`flex shrink-0 items-center gap-3 border-b border-border bg-bg-elevated px-4 pt-[env(safe-area-inset-top)]${props.soCelular ? ' md:hidden' : ''}`}
    >
      <p className="min-w-0 flex-1 text-sm leading-tight text-fg">{props.texto}</p>
      {props.children}
    </aside>
  );
}
