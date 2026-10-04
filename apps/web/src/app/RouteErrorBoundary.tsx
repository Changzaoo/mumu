import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { anotar } from '@/lib/telemetry/diario';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';

function ErrorCard({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger">
        <TriangleAlert className="size-6" />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
        <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw /> Tentar novamente
          </Button>
        )}
        <Link to="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}

/** Route-level errorElement (data router errors: loaders, 404 responses…). */
export function RouteErrorBoundary() {
  const error = useRouteError();
  // "Alguma coisa rolou": a tela que caiu, com a rota e a mensagem, no diário
  // de bordo — antes a queda só ia para o console de quem não estava olhando.
  useEffect(() => {
    const texto = isRouteErrorResponse(error)
      ? `HTTP ${error.status} ${error.statusText}`
      : error instanceof Error
        ? error.message
        : String(error);
    anotar('erro', 'tela', `${location.pathname}: ${texto}`);
  }, [error]);
  if (isRouteErrorResponse(error)) {
    return (
      <ErrorCard
        title={`Erro ${error.status}`}
        description={error.statusText || 'Algo não saiu como esperado.'}
        onRetry={() => window.location.reload()}
      />
    );
  }
  return (
    <ErrorCard
      title="Algo deu errado"
      description="Um erro inesperado interrompeu esta página. Recarregue e tente de novo."
      onRetry={() => window.location.reload()}
    />
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** Render-time error boundary wrapping each lazy page. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[radinho.online] page crashed:', error, info.componentStack);
    // A página caiu: rota, mensagem e o componente de cima da pilha, no diário
    // de bordo — é o que aponta ONDE em vez de só "Algo deu errado".
    const topo = /\n\s*(?:at|in) (\w+)/.exec(info.componentStack ?? '')?.[1];
    anotar('erro', 'tela', `${location.pathname}: ${error.message}${topo ? ` em <${topo}>` : ''}`);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <ErrorCard
            title="Algo deu errado"
            description="Esta página encontrou um erro. Tente novamente."
            onRetry={() => this.setState({ hasError: false })}
          />
        )
      );
    }
    return this.props.children;
  }
}
