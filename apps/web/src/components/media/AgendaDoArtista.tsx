/**
 * "Agenda e notícias" — a seção do mundo da música na ficha do artista.
 *
 * Mostra o que o servidor já trouxe (ver lib/mundo/mundo.ts): próximos shows
 * com local, data/hora, preço e botão de ingresso; transmissões do canal
 * oficial (YouTube embutido quando o vídeo permite e a pessoa é adulta;
 * senão só o link); prêmios e indicações; lançamentos. Sem nada, a seção
 * não aparece — vazio é melhor que um título órfão.
 *
 * TELEMETRIA: os botões têm `aria-label` próprio ("ingresso: <artista>",
 * "transmissão: <artista>"), que é o que o contador de cliques da telemetria
 * lê; e cada clique entra no diário no canal `mundo`.
 */
import { useState } from 'react';
import { Award, CalendarDays, Disc3, MapPin, Radio, Ticket } from 'lucide-react';
import { anotar } from '@/lib/telemetry/diario';
import {
  agruparAgenda,
  podeVerEmbed,
  quandoPorExtenso,
  useAgendaDoArtista,
  type EventoDoMundo,
} from '@/lib/mundo/mundo';
import { cn } from '@/lib/utils';

function Titulo({ icone: Icone, children }: { icone: typeof Ticket; children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
      <Icone className="size-4" /> {children}
    </h3>
  );
}

function CartaoDeShow({ evento, artista }: { evento: EventoDoMundo; artista: string }) {
  const data = quandoPorExtenso(evento.quando);
  const link = evento.linkIngresso ?? evento.link;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-fg">{evento.titulo}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-fg-muted">
          {data && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" /> {data}
            </span>
          )}
          {evento.local && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" /> {evento.local}
            </span>
          )}
        </p>
        <p className="mt-1 text-[12px] text-fg-subtle">
          {evento.preco ? `Ingressos ${evento.preco}` : 'Preço não informado pela fonte'}
          {' · '}
          fonte: {evento.fonte}
        </p>
      </div>
      {link && (
        <a
          href={link}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`ingresso: ${artista}`}
          onClick={() =>
            anotar('mundo', 'ingresso', { artista, fonte: evento.fonte, id: evento.id })
          }
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg transition-transform hover:scale-[1.03]"
        >
          <Ticket className="size-4" /> {evento.linkIngresso ? 'Ingressos' : 'Ver evento'}
        </a>
      )}
    </li>
  );
}

function Transmissao({ evento, artista }: { evento: EventoDoMundo; artista: string }) {
  const [aberta, setAberta] = useState(false);
  const podeEmbutir = evento.embed && evento.youtubeId && podeVerEmbed();
  const data = quandoPorExtenso(evento.quando);
  const abrir = (): void => {
    anotar('mundo', 'transmissao', { artista, id: evento.id, embed: Boolean(podeEmbutir) });
    setAberta(true);
  };
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
      {podeEmbutir && aberta ? (
        <div className="aspect-video w-full bg-black">
          {/* Embed OFICIAL do YouTube, só depois do clique (não carrega iframe
              de terceiro por conta própria) e só se o vídeo permite. */}
          <iframe
            title={evento.titulo}
            src={`https://www.youtube.com/embed/${evento.youtubeId}?autoplay=1&rel=0`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="size-full"
          />
        </div>
      ) : null}
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">{evento.titulo}</p>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            {evento.descricao}
            {data ? ` · ${data}` : ''}
          </p>
        </div>
        {podeEmbutir
          ? !aberta && (
              <button
                type="button"
                aria-label={`transmissão: ${artista}`}
                onClick={abrir}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg"
              >
                <Radio className="size-4" /> Assistir aqui
              </button>
            )
          : evento.link && (
              <a
                href={evento.link}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`transmissão: ${artista}`}
                onClick={() =>
                  anotar('mundo', 'transmissao', { artista, id: evento.id, embed: false })
                }
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold text-fg hover:bg-fg/5"
              >
                <Radio className="size-4" /> Ver no YouTube
              </a>
            )}
      </div>
    </li>
  );
}

function Linha({
  evento,
  artista,
  icone: Icone,
}: {
  evento: EventoDoMundo;
  artista: string;
  icone: typeof Award;
}) {
  const ano = evento.quando ? new Date(evento.quando).getUTCFullYear() : null;
  const conteudo = (
    <>
      <Icone className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-fg">{evento.titulo}</span>
        {evento.descricao && <span className="text-fg-muted"> · {evento.descricao}</span>}
        {ano && <span className="text-fg-subtle"> · {ano}</span>}
      </span>
    </>
  );
  const classe = 'flex items-start gap-2 py-1.5 text-[13px]';
  return (
    <li>
      {evento.link ? (
        <a
          href={evento.link}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => anotar('mundo', evento.tipo.toLowerCase(), { artista, id: evento.id })}
          className={cn(classe, 'hover:text-accent')}
        >
          {conteudo}
        </a>
      ) : (
        <span className={classe}>{conteudo}</span>
      )}
    </li>
  );
}

export function AgendaDoArtista({ artista, ligado = true }: { artista: string; ligado?: boolean }) {
  const { data } = useAgendaDoArtista(artista, ligado);
  if (!data || data.eventos.length === 0) return null;
  const g = agruparAgenda(data.eventos);
  const temAlgo =
    g.proximos.length + g.transmissoes.length + g.premios.length + g.lancamentos.length > 0;
  if (!temAlgo) return null;

  return (
    <section aria-label="Agenda e notícias" className="max-w-4xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-fg">Agenda e notícias</h2>
        {data.atualizadoEm && (
          <p className="text-[12px] text-fg-subtle">
            Atualizado {quandoPorExtenso(data.atualizadoEm)} · MusicBrainz, Wikidata e o canal
            oficial
          </p>
        )}
      </div>

      {g.proximos.length > 0 && (
        <div className="space-y-2">
          <Titulo icone={Ticket}>Próximos shows</Titulo>
          <ul className="space-y-2">
            {g.proximos.slice(0, 8).map((e) => (
              <CartaoDeShow key={e.id} evento={e} artista={artista} />
            ))}
          </ul>
        </div>
      )}

      {g.transmissoes.length > 0 && (
        <div className="space-y-2">
          <Titulo icone={Radio}>Ao vivo no canal oficial</Titulo>
          <ul className="space-y-2">
            {g.transmissoes.slice(0, 3).map((e) => (
              <Transmissao key={e.id} evento={e} artista={artista} />
            ))}
          </ul>
        </div>
      )}

      {(g.premios.length > 0 || g.lancamentos.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {g.premios.length > 0 && (
            <div className="space-y-1">
              <Titulo icone={Award}>Prêmios e indicações</Titulo>
              <ul>
                {g.premios.slice(0, 8).map((e) => (
                  <Linha key={e.id} evento={e} artista={artista} icone={Award} />
                ))}
              </ul>
            </div>
          )}
          {g.lancamentos.length > 0 && (
            <div className="space-y-1">
              <Titulo icone={Disc3}>Lançamentos</Titulo>
              <ul>
                {g.lancamentos.slice(0, 6).map((e) => (
                  <Linha key={e.id} evento={e} artista={artista} icone={Disc3} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
