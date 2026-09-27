/**
 * "ADICIONAR À PLAYLIST", DE QUALQUER LUGAR.
 *
 * Até aqui a única forma de pôr uma música numa lista era abrir a lista e
 * procurar a música lá dentro. O item "Adicionar à playlist" do menu de cada
 * faixa existia, mas só aparecia quando a tela passava um `onAddToPlaylist` —
 * e nenhuma passava. Resultado: montar uma playlist exigia saber o nome de cada
 * música de cor.
 *
 * Agora qualquer ponto do app chama `abrirAdicionarAPlaylist(faixas)` e este
 * diálogo resolve: escolhe a lista com um toque (as que já têm a música vêm
 * marcadas) ou cria uma nova ali mesmo, já com a música dentro. O host mora no
 * AppShell, como o de compartilhar.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ListMusic, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { TrackDto } from '@radinho/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { isCatalogTrack } from '@/lib/catalog/isCatalogTrack';
import * as localPlaylists from '@/lib/local/localPlaylists';
import { cn } from '@/lib/utils';

let abrirListener: ((faixas: TrackDto[]) => void) | null = null;

/** Abre o seletor de playlist para estas faixas. */
export function abrirAdicionarAPlaylist(faixas: TrackDto | TrackDto[]): void {
  const lista = Array.isArray(faixas) ? faixas : [faixas];
  if (lista.length > 0) abrirListener?.(lista);
}

function capaDaLista(playlist: localPlaylists.LocalPlaylist): string | null {
  return localPlaylists.toPlaylistDto(playlist).coverUrl ?? null;
}

export function AdicionarAPlaylistHost() {
  const [faixas, setFaixas] = useState<TrackDto[] | null>(null);
  const [nome, setNome] = useState('');
  const [criando, setCriando] = useState(false);
  const queryClient = useQueryClient();
  const playlists = useSyncExternalStore(localPlaylists.subscribe, localPlaylists.list, () => []);

  useEffect(() => {
    abrirListener = (lista) => {
      setFaixas(lista);
      setNome('');
      setCriando(false);
    };
    return () => {
      abrirListener = null;
    };
  }, []);

  // Faixa de fora (Audius/Apple/prévia) não entra em lista do aparelho — ver
  // `ownTracksOnly` em localPlaylists. Avisar antes vale mais que falhar depois.
  const aceitas = useMemo(() => (faixas ?? []).filter((t) => !isCatalogTrack(t)), [faixas]);
  const uma = aceitas.length === 1 ? aceitas[0] : null;

  const fechar = (): void => setFaixas(null);

  const atualizarTelas = (id: string): void => {
    void queryClient.invalidateQueries({ queryKey: ['playlist', id] });
    void queryClient.invalidateQueries({ queryKey: ['playlists'] });
  };

  const adicionar = (playlist: localPlaylists.LocalPlaylist): void => {
    const entraram = localPlaylists.addTracks(playlist.id, aceitas);
    atualizarTelas(playlist.id);
    fechar();
    if (entraram === 0) {
      toast(`Já estava em "${playlist.title}"`);
      return;
    }
    toast.success(
      entraram === 1
        ? `Adicionada a "${playlist.title}"`
        : `${entraram} músicas adicionadas a "${playlist.title}"`,
    );
  };

  const criar = (): void => {
    const titulo = nome.trim();
    if (!titulo) {
      toast.error('Dê um nome para a playlist.');
      return;
    }
    const nova = localPlaylists.create(titulo, aceitas);
    atualizarTelas(nova.id);
    fechar();
    toast.success(`Playlist "${nova.title}" criada`);
  };

  const contem = (playlist: localPlaylists.LocalPlaylist): boolean =>
    aceitas.length > 0 && aceitas.every((t) => playlist.trackIds.includes(t.id));

  return (
    <Dialog open={faixas !== null} onOpenChange={(aberto) => !aberto && fechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar à playlist</DialogTitle>
          <DialogDescription>
            {uma
              ? `${uma.title} — ${uma.artists.map((a) => a.name).join(', ')}`
              : `${aceitas.length} músicas`}
          </DialogDescription>
        </DialogHeader>

        {aceitas.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Essa música é de fora da sua biblioteca. Adicione-a à biblioteca para poder colocá-la
            numa playlist.
          </p>
        ) : (
          <div className="space-y-3">
            {criando ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  criar();
                }}
              >
                <Input
                  autoFocus
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome da nova playlist"
                  aria-label="Nome da nova playlist"
                  maxLength={80}
                />
                <Button type="submit">Criar</Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCriando(true)}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-fg/5"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-fg/10">
                  <Plus className="size-6" />
                </span>
                <span className="font-semibold text-fg">Nova playlist</span>
              </button>
            )}

            <ul className="max-h-[50vh] space-y-1 overflow-y-auto" aria-label="Suas playlists">
              {playlists.map((playlist) => {
                const ja = contem(playlist);
                const capa = capaDaLista(playlist);
                return (
                  <li key={playlist.id}>
                    <button
                      type="button"
                      onClick={() => adicionar(playlist)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-fg/5',
                      )}
                    >
                      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-fg/10">
                        {capa ? (
                          <img
                            src={capa}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <ListMusic className="size-6 text-fg-muted" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-fg">{playlist.title}</span>
                        <span className="block text-xs text-fg-muted">
                          {playlist.trackIds.length}{' '}
                          {playlist.trackIds.length === 1 ? 'música' : 'músicas'}
                        </span>
                      </span>
                      {ja && (
                        <Check className="size-5 shrink-0 text-fg" aria-label="Já está nesta" />
                      )}
                    </button>
                  </li>
                );
              })}
              {playlists.length === 0 && !criando && (
                <li className="px-2 py-3 text-sm text-fg-muted">
                  Você ainda não tem playlists — crie a primeira acima.
                </li>
              )}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
