import { useState } from 'react';
import { toast } from 'sonner';
import { ClipboardPaste } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isPlaylistUrl } from '@/lib/local/importerHelper';
import * as localLibrary from '@/lib/local/localLibrary';
import * as importQueue from '@/lib/local/importQueue';
import { prepararLink } from '@/lib/local/linkColado';

/**
 * Texto colado/compartilhado → fila de importação. Um caminho só para o
 * diálogo "Adicionar música", o onboarding e o "Compartilhar → radinho".
 * Devolve `true` quando enfileirou.
 */
export function enfileirarLink(texto: string, forcarPlaylist = false): boolean {
  const preparado = prepararLink(texto);
  if (!preparado.ok) {
    toast.error(preparado.message);
    return false;
  }
  const link = preparado.url;
  const validacao = localLibrary.validateImportUrl(link);
  if (!validacao.ok) {
    toast.error(validacao.message);
    return false;
  }
  const playlist = forcarPlaylist || isPlaylistUrl(link);
  importQueue.enqueue(link, { forcePlaylist: playlist });
  toast.success(
    playlist
      ? 'Playlist na fila — baixa em segundo plano, mesmo se você sair daqui'
      : 'Música na fila — baixa em segundo plano, mesmo se você sair daqui',
  );
  return true;
}

/**
 * Campo de link com botão "Colar".
 *
 * A área de transferência só é lida quando a pessoa TOCA em "Colar" — nunca
 * sozinha ao abrir a tela. Ler o clipboard sem pedir é espiar o que a pessoa
 * copiou (senha, endereço, conversa), e o navegador mostra um aviso de
 * permissão que parece exatamente isso.
 */
export function ColarLink({ aoAdicionar }: { aoAdicionar?: () => void }) {
  const [texto, setTexto] = useState('');
  const podeColar = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText;

  const adicionar = (valor = texto): void => {
    if (!valor.trim()) return;
    if (enfileirarLink(valor)) {
      setTexto('');
      aoAdicionar?.();
    }
  };

  const colar = async (): Promise<void> => {
    try {
      const copiado = await navigator.clipboard.readText();
      setTexto(copiado);
      if (copiado.trim()) adicionar(copiado);
    } catch {
      toast.error('Não consegui ler o que você copiou. Cole no campo com um toque longo.');
    }
  };

  return (
    <div className="flex gap-2">
      <Input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && adicionar()}
        placeholder="Link do Spotify, YouTube, Deezer…"
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        aria-label="Link da música, álbum ou playlist"
      />
      {texto.trim() || !podeColar ? (
        <Button variant="accent" disabled={!texto.trim()} onClick={() => adicionar()}>
          Adicionar
        </Button>
      ) : (
        <Button variant="accent" onClick={() => void colar()}>
          <ClipboardPaste aria-hidden /> Colar
        </Button>
      )}
    </div>
  );
}
