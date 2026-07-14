import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AurialLogo } from '@/components/brand/AurialMark';
import { Button } from '@/components/ui/button';
import { useAuthUser } from '@/hooks/useAuthUser';
import { authDisabled, signInGoogle } from '@/lib/firebase';

const AUTH_ERRORS: Record<string, string> = {
  'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco.',
  'auth/popup-closed-by-user': 'Janela fechada antes de concluir.',
  'auth/network-request-failed': 'Falha de rede. Verifique sua conexão.',
};

function friendlyError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  return (
    (code && AUTH_ERRORS[code]) ??
    (error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.')
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.74 2.98-4.3 2.98-7.35Z"
      />
      <path
        fill="currentColor"
        opacity=".7"
        d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.75-5.59-4.1H3.06v2.58A10 10 0 0 0 12 22Z"
      />
      <path
        fill="currentColor"
        opacity=".5"
        d="M6.41 13.92a6 6 0 0 1 0-3.83V7.5H3.06a10 10 0 0 0 0 9l3.35-2.58Z"
      />
      <path
        fill="currentColor"
        opacity=".85"
        d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.97 9.97 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.35 2.6C7.2 7.73 9.4 5.98 12 5.98Z"
      />
    </svg>
  );
}

/**
 * /login — outside the shell. Glass card over two ambient glows on deep black.
 * GOOGLE ONLY: os fluxos de e-mail/senha, link mágico e convidado foram
 * removidos — nunca funcionaram de ponta a ponta (verificação de e-mail nunca
 * chegava) e viravam contas que serviços com gate de auth recusavam. Uma conta
 * Google chega verificada e funciona em tudo.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuthUser();
  const [pending, setPending] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const loginGoogle = async (): Promise<void> => {
    setPending(true);
    try {
      await signInGoogle();
      void navigate('/', { replace: true });
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-bg p-4">
      {/* Ambient glows — accent + info, the only decoration on this page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 size-[36rem] rounded-full bg-accent opacity-20 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-40 size-[36rem] rounded-full bg-info opacity-15 blur-[120px]"
      />

      <main className="glass relative w-full max-w-sm rounded-2xl p-8">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <AurialLogo />
          <p className="text-sm text-fg-muted">Entre para ouvir as músicas completas</p>
        </div>

        {authDisabled ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-fg-muted">
              Modo demonstração — o login está desativado porque o Firebase não foi configurado.
            </p>
            <Button variant="accent" className="w-full" onClick={() => void navigate('/')}>
              Continuar sem conta
            </Button>
          </div>
        ) : (
          <>
            <Button
              variant="accent"
              className="w-full"
              disabled={pending}
              onClick={() => void loginGoogle()}
            >
              {pending ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
              Continuar com Google
            </Button>
            <p className="mt-6 text-center text-[13px] text-fg-muted">
              Grátis. Sua biblioteca sincroniza em todos os aparelhos — sem conta, você ouve prévias
              de 30 segundos.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
