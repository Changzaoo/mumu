/**
 * "Sobre o artista" — card largo com a FOTO do artista de fundo, o número de
 * ouvintes/fãs e a descrição por cima (padrão das páginas de artista de
 * streaming). O texto começa cortado em poucas linhas com "…" e abre no clique.
 *
 * Legibilidade nos dois temas: o gradiente parte de `--bg` (preto no escuro,
 * quase branco no claro) e o texto usa `--fg`, que é sempre o contraste de
 * `--bg`. Assim a foto pode ser clara ou escura sem sumir com a descrição.
 */
import { useId, useState, type ReactNode } from 'react';
import { MicVocal } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SobreOArtistaProps {
  /** Nome do artista — só para o texto alternativo da foto. */
  name: string;
  imageUrl?: string | null;
  /** "1,2 mi ouvintes mensais", "340 mil fãs"… omitido quando não há número. */
  stat?: string | null;
  text: string;
  /** Crédito da descrição (ex.: link para a Wikipédia). */
  fonte?: ReactNode;
  /** Extras abaixo do card (gravadora etc.). */
  children?: ReactNode;
}

export function SobreOArtista({ name, imageUrl, stat, text, fonte, children }: SobreOArtistaProps) {
  const [aberto, setAberto] = useState(false);
  const textoId = useId();

  return (
    <section aria-label="Sobre o artista" className="max-w-4xl space-y-3">
      <h2 className="text-xl font-semibold tracking-tight text-fg">Sobre o artista</h2>
      <div className="relative isolate flex min-h-72 flex-col justify-end overflow-hidden rounded-xl border border-border bg-bg-elevated md:min-h-96">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Foto de ${name}`}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 -z-10 size-full object-cover object-top"
          />
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 -z-10 grid place-items-center text-fg-subtle"
          >
            <MicVocal className="size-16" />
          </span>
        )}
        {/* Véu para o texto: denso embaixo, transparente em cima (a foto respira). */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-t from-bg via-bg/75 to-transparent"
        />
        <div className="space-y-2 p-5 md:p-6">
          {stat && <p className="text-base font-bold text-fg">{stat}</p>}
          <button
            type="button"
            aria-expanded={aberto}
            aria-controls={textoId}
            onClick={() => setAberto((v) => !v)}
            className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p
              id={textoId}
              className={cn(
                'whitespace-pre-line text-sm leading-relaxed text-fg',
                !aberto && 'line-clamp-3',
              )}
            >
              {text}
            </p>
            <span className="mt-1 inline-block text-[13px] font-semibold text-fg-muted hover:text-fg">
              {aberto ? 'Mostrar menos' : 'Mostrar mais'}
            </span>
          </button>
        </div>
      </div>
      {(fonte || children) && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-[12px]">
          {children}
          {fonte}
        </div>
      )}
    </section>
  );
}
