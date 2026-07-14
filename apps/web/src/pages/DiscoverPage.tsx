/**
 * /discover — NOSSAS músicas organizadas por categoria (gênero). Os tiles vêm
 * da biblioteca real do usuário; um AGENTE DE CATEGORIAS fica de plantão em
 * segundo plano (lib/local/genreAgent) classificando pela IA toda faixa que
 * ainda não tem gênero — o grid cresce sozinho conforme ele trabalha.
 */
import { useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { Compass, Loader2, Music, Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/media/EmptyState';
import * as genreAgent from '@/lib/local/genreAgent';
import * as localLibrary from '@/lib/local/localLibrary';

const EMPTY: localLibrary.LibraryEntry[] = [];

/** A stable-ish hue per genre for the tinted tiles. */
function hueFor(genre: string): number {
  let hash = 0;
  for (let i = 0; i < genre.length; i++) hash = (hash * 31 + genre.charCodeAt(i)) % 360;
  return hash;
}

export default function DiscoverPage() {
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => EMPTY);
  const agentRunning = useSyncExternalStore(
    genreAgent.subscribe,
    genreAgent.isRunning,
    () => false,
  );
  const genres = localLibrary.genreGroups();
  const uncategorized = entries.filter((e) => !e.track.genre?.trim()).length;

  return (
    <div className="space-y-6 py-4">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-fg">
          <Compass className="size-7 text-fg-muted" /> Descobrir
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Suas músicas organizadas por categoria — toque num gênero para explorar.
        </p>
      </header>

      {/* Status do agente de categorias (plantão). */}
      {uncategorized > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-[13px] text-fg-muted">
          {agentRunning ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
          ) : (
            <Sparkles className="size-4 shrink-0 text-fg-subtle" />
          )}
          {agentRunning
            ? `Agente organizando a biblioteca — ${uncategorized} ${uncategorized === 1 ? 'faixa' : 'faixas'} sem categoria na fila`
            : `${uncategorized} ${uncategorized === 1 ? 'faixa aguarda' : 'faixas aguardam'} categoria — o agente classifica aos poucos, sozinho`}
        </div>
      )}

      {genres.length === 0 ? (
        <EmptyState
          icon={Music}
          title="Nada categorizado ainda"
          description={
            entries.length === 0
              ? 'Adicione músicas — elas aparecem aqui organizadas por gênero.'
              : 'O agente de categorias está trabalhando: os gêneros aparecem aqui em breve.'
          }
        />
      ) : (
        <section aria-label="Gêneros">
          <h2 className="mb-3 text-xl font-semibold tracking-tight text-fg">Explorar por gênero</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {genres.map((genre, index) => {
              const hue = hueFor(genre.genre);
              return (
                <motion.div
                  key={genre.genre}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.2 }}
                >
                  <Link
                    to={`/genero/${encodeURIComponent(genre.genre)}`}
                    className="group relative block overflow-hidden rounded-xl border border-border bg-bg-elevated p-4 pt-10 transition-transform duration-200 hover:scale-[1.02] focus-visible:scale-[1.02]"
                    style={{
                      backgroundImage: `linear-gradient(135deg, hsl(${hue} 80% 50% / 0.28) 0%, hsl(${(hue + 40) % 360} 80% 45% / 0.10) 100%)`,
                    }}
                  >
                    {genre.coverUrl && (
                      <img
                        src={genre.coverUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="pointer-events-none absolute -right-2 -top-2 size-16 rotate-12 rounded-lg object-cover opacity-80 shadow-lg"
                      />
                    )}
                    <span className="relative block text-base font-semibold tracking-tight text-fg">
                      {genre.genre}
                    </span>
                    <span className="relative block text-[12px] text-fg-muted">
                      {genre.tracks.length} {genre.tracks.length === 1 ? 'música' : 'músicas'}
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
