import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Ghost, Loader2, Mail, WandSparkles } from 'lucide-react';
import { AurialLogo } from '@/components/brand/AurialMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useAuthUser } from '@/hooks/useAuthUser';
import {
  authDisabled,
  completeMagicLink,
  sendMagicLink,
  signInAnonymously,
  signInEmail,
  signInGithub,
  signInGoogle,
  signUpEmail,
} from '@/lib/firebase';
import { cn } from '@/lib/utils';

const credentialsSchema = z.object({
  email: z.string().email('Informe um e-mail válido'),
  password: z.string().min(6, 'A senha precisa de pelo menos 6 caracteres'),
});
type CredentialsInput = z.infer<typeof credentialsSchema>;

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Conta não encontrada.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/email-already-in-use': 'Este e-mail já tem uma conta. Tente entrar.',
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

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.1.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
      />
    </svg>
  );
}

/**
 * /login — outside the shell. Glass card over two ambient glows on deep black.
 * Google / GitHub / anonymous, e-mail+senha (entrar ou criar) and magic link.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuthUser();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [pending, setPending] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<CredentialsInput>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  // Finish magic-link flows landing on /login.
  useEffect(() => {
    void completeMagicLink()
      .then((cred) => {
        if (cred) {
          toast.success('Acesso concluído. Bem-vindo ao radinho.online.');
          void navigate('/', { replace: true });
        }
      })
      .catch((error: unknown) => toast.error(friendlyError(error)));
  }, [navigate]);

  if (!loading && user) return <Navigate to="/" replace />;

  const withPending = async (key: string, action: () => Promise<unknown>): Promise<void> => {
    setPending(key);
    try {
      await action();
      void navigate('/', { replace: true });
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setPending(null);
    }
  };

  const onSubmit = handleSubmit(async ({ email, password }) => {
    try {
      if (mode === 'signin') await signInEmail(email, password);
      else await signUpEmail(email, password);
      void navigate('/', { replace: true });
    } catch (error) {
      toast.error(friendlyError(error));
    }
  });

  const onMagicLink = async (): Promise<void> => {
    const email = getValues('email');
    if (!credentialsSchema.shape.email.safeParse(email).success) {
      toast.error('Informe seu e-mail para receber o link mágico.');
      return;
    }
    setPending('magic');
    try {
      await sendMagicLink(email);
      toast.success(`Link de acesso enviado para ${email}. Confira sua caixa de entrada.`);
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setPending(null);
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
          <p className="text-sm text-fg-muted">
            {mode === 'signin' ? 'Entre para continuar ouvindo' : 'Crie sua conta em segundos'}
          </p>
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
            <div className="space-y-2.5">
              <Button
                variant="outline"
                className="w-full"
                disabled={pending !== null}
                onClick={() => void withPending('google', signInGoogle)}
              >
                {pending === 'google' ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
                Continuar com Google
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={pending !== null}
                onClick={() => void withPending('github', signInGithub)}
              >
                {pending === 'github' ? <Loader2 className="animate-spin" /> : <GithubIcon />}
                Continuar com GitHub
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                disabled={pending !== null}
                onClick={() => void withPending('anon', signInAnonymously)}
              >
                {pending === 'anon' ? <Loader2 className="animate-spin" /> : <Ghost />}
                Entrar como convidado
              </Button>
            </div>

            <div className="my-6 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-fg-subtle">ou</span>
              <Separator className="flex-1" />
            </div>

            <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@exemplo.com"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                />
                {errors.email && <p className="text-xs text-danger">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  aria-invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-xs text-danger">{errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                variant="accent"
                className="w-full"
                disabled={isSubmitting || pending !== null}
              >
                {isSubmitting ? <Loader2 className="animate-spin" /> : <Mail />}
                {mode === 'signin' ? 'Entrar com e-mail' : 'Criar conta'}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => void onMagicLink()}
              disabled={pending !== null}
              className={cn(
                'mt-3 flex w-full items-center justify-center gap-2 rounded-md py-2 text-[13px] font-medium text-fg-muted transition-colors',
                'hover:text-fg disabled:opacity-50',
              )}
            >
              {pending === 'magic' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <WandSparkles className="size-4" />
              )}
              Receber link mágico por e-mail
            </button>

            <p className="mt-6 text-center text-[13px] text-fg-muted">
              {mode === 'signin' ? 'Ainda não tem conta?' : 'Já tem conta?'}{' '}
              <button
                type="button"
                onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                className="font-medium text-accent hover:underline"
              >
                {mode === 'signin' ? 'Criar conta' : 'Entrar'}
              </button>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
