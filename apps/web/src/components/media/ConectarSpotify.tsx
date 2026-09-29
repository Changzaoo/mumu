import { useState } from 'react';
import { toast } from 'sonner';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  conectarSpotify,
  ehAppNativo,
  redirectUriDoSpotify,
  spotifyClientId,
} from '@/lib/local/spotifyCurtidas';

/**
 * "Conectar Spotify" — baixa as CURTIDAS da pessoa (link `collection/tracks`
 * é privado; ver spotifyCurtidas.ts). Sem client id configurado o botão não
 * finge que funciona: mostra o passo a passo para quem administra o site.
 */
export function BotaoConectarSpotify() {
  const [ajuda, setAjuda] = useState(false);
  const configurado = Boolean(spotifyClientId());

  const conectar = (): void => {
    if (!configurado) {
      setAjuda((v) => !v);
      return;
    }
    if (ehAppNativo()) {
      // O retorno do login do Spotify não volta para dentro do app Android.
      toast.error('Conecte o Spotify pelo site no navegador — as músicas entram na mesma conta.');
      return;
    }
    conectarSpotify().catch(() => toast.error('Não consegui abrir o login do Spotify.'));
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" className="w-full" onClick={conectar}>
        <Heart /> Baixar minhas curtidas do Spotify
      </Button>
      {ajuda && !configurado && (
        <ol className="list-decimal space-y-1 rounded-lg border border-border bg-bg-elevated p-3 pl-7 text-[12px] leading-relaxed text-fg-muted">
          <li>
            Quem administra o site cria um app em developer.spotify.com/dashboard (“Create app”,
            marcando “Web API”).
          </li>
          <li>
            Em “Redirect URIs”, cadastra exatamente{' '}
            <code className="break-all">{redirectUriDoSpotify()}</code>.
          </li>
          <li>
            Copia o “Client ID” para a variável <code>VITE_SPOTIFY_CLIENT_ID</code> do site e
            publica de novo. Não há segredo: o login usa PKCE.
          </li>
          <li>
            Enquanto o app estiver em modo de desenvolvimento, cada conta que for usar precisa estar
            em “User Management”.
          </li>
          <li>
            Até lá: no Spotify, selecione as curtidas → “Adicionar à playlist” → nova playlist
            pública, e cole o link dela aqui.
          </li>
        </ol>
      )}
    </div>
  );
}
