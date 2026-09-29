/**
 * /conectar-spotify — onde o login do Spotify devolve a pessoa (`?code=…`).
 * Troca o código, lê as curtidas e enfileira cada uma como faixa do Spotify;
 * a fila (`importQueue`) baixa em segundo plano como qualquer link colado.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { RadinhoLogo } from '@/components/brand/RadinhoMark';
import { Button } from '@/components/ui/button';
import * as importQueue from '@/lib/local/importQueue';
import { concluirConexao, ErroSpotify } from '@/lib/local/spotifyCurtidas';

type Estado =
  | { fase: 'lendo' }
  | { fase: 'pronto'; total: number }
  | { fase: 'erro'; mensagem: string; tentarDeNovo: boolean };

export default function RetornoDoSpotify() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado>({ fase: 'lendo' });
  // Lido UMA vez antes do efeito: o StrictMode roda o efeito duas vezes, e a
  // segunda já encontraria a barra de endereço limpa (ver replaceState abaixo).
  const [busca] = useState(() => window.location.search);

  useEffect(() => {
    // O `code` é de uso único e não deve ficar no histórico nem ser recarregado.
    window.history.replaceState(null, '', window.location.pathname);
    let vivo = true;
    concluirConexao(busca)
      .then((links) => {
        if (!vivo) return;
        importQueue.enqueue(links);
        setEstado({ fase: 'pronto', total: links.length });
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        const e = err instanceof ErroSpotify ? err : null;
        setEstado({
          fase: 'erro',
          mensagem: e?.message ?? 'Não consegui ler suas curtidas do Spotify.',
          // Rede caída: vale tentar de novo. Resto: a pessoa precisa agir.
          tentarDeNovo: !e || e.motivo === 'rede' || e.motivo === 'estado',
        });
      });
    return () => {
      vivo = false;
    };
  }, [busca]);

  const sair = (): void => void navigate('/', { replace: true });

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-bg px-5 text-center">
      <RadinhoLogo />
      <div className="max-w-sm space-y-2">
        {estado.fase === 'lendo' && (
          <p className="text-sm text-fg-muted">Lendo suas curtidas do Spotify…</p>
        )}
        {estado.fase === 'pronto' && (
          <>
            <h1 className="text-xl font-semibold text-fg">
              {estado.total > 0
                ? `${estado.total} ${estado.total === 1 ? 'música' : 'músicas'} na fila`
                : 'Nenhuma música curtida'}
            </h1>
            <p className="text-sm text-fg-muted">
              {estado.total > 0
                ? 'Baixam em segundo plano, mesmo se você sair daqui.'
                : 'Sua lista de curtidas no Spotify está vazia.'}
            </p>
          </>
        )}
        {estado.fase === 'erro' && (
          <p className="text-sm text-fg-muted">
            {estado.mensagem}
            {estado.tentarDeNovo && ' Abra “Adicionar música” e conecte de novo.'}
          </p>
        )}
      </div>
      {estado.fase !== 'lendo' && (
        <Button variant="accent" onClick={sair}>
          Ir para o início
        </Button>
      )}
    </div>
  );
}
