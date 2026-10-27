/**
 * O AVISO DA HOME — para quem segue o artista: show ou transmissão chegando,
 * prêmio ou lançamento recente. Lê a lista de seguidos (lib/local/
 * artistasSeguidos) e pergunta ao servidor o que há de novo para eles.
 *
 * Some sozinho sem seguidos ou sem novidade. Cada cartão leva à ficha do
 * artista (onde está a agenda inteira) ou direto ao ingresso quando há link.
 * Respeita a faixa etária: artista que a pessoa não pode ouvir não avisa.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { Award, Disc3, Radio, Ticket } from 'lucide-react';
import * as artistasSeguidos from '@/lib/local/artistasSeguidos';
import { assinar, versaoDoFiltro } from '@/lib/conteudo/faixaEtaria';
import { anotar } from '@/lib/telemetry/diario';
import {
  podeVerAgendaDe,
  quandoPorExtenso,
  useAvisosDoMundo,
  type AvisoDoMundo as Aviso,
} from '@/lib/mundo/mundo';

const SEM_SEGUIDOS: artistasSeguidos.ArtistaSeguido[] = [];

function fraseDoAviso(a: Aviso): { icone: typeof Ticket; texto: string } {
  const quando = quandoPorExtenso(a.quando);
  switch (a.tipo) {
    case 'SHOW':
    case 'FESTIVAL':
      return {
        icone: Ticket,
        texto: [a.local ? `toca em ${a.local}` : 'tem show marcado', quando]
          .filter(Boolean)
          .join(' · '),
      };
    case 'TRANSMISSAO':
      return { icone: Radio, texto: a.descricao ?? 'transmite ao vivo' };
    case 'PREMIO':
      return {
        icone: Award,
        texto: `${a.descricao?.startsWith('Indicação') ? 'indicado ao' : 'ganhou o'} ${a.titulo}`,
      };
    default:
      return { icone: Disc3, texto: `lançou "${a.titulo}"` };
  }
}

export function AvisoDoMundo() {
  const seguidos = useSyncExternalStore(
    artistasSeguidos.subscribe,
    artistasSeguidos.list,
    () => SEM_SEGUIDOS,
  );
  useSyncExternalStore(assinar, versaoDoFiltro, versaoDoFiltro);
  const nomes = useMemo(() => seguidos.map((s) => s.nome), [seguidos]);
  const { data } = useAvisosDoMundo(nomes);
  const avisos = useMemo(
    () => (data ?? []).filter((a) => podeVerAgendaDe(a.artista)).slice(0, 6),
    [data],
  );
  if (avisos.length === 0) return null;

  return (
    <section aria-label="Novidades de quem você segue" className="space-y-2 px-3">
      <h2 className="text-lg font-semibold tracking-tight text-fg">Novidades de quem você segue</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {avisos.map((a) => {
          const { icone: Icone, texto } = fraseDoAviso(a);
          const destino = a.linkIngresso ?? null;
          const conteudo = (
            <>
              <Icone className="size-5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 text-[13px]">
                <span className="font-semibold text-fg">{a.artista}</span>{' '}
                <span className="text-fg-muted">{texto}</span>
                {a.preco && <span className="text-fg-subtle"> · {a.preco}</span>}
              </span>
            </>
          );
          const classe =
            'flex items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 transition-colors hover:bg-fg/5';
          const registrar = (): void =>
            anotar('mundo', 'aviso', {
              artista: a.artista,
              tipo: a.tipo,
              id: a.id,
              ingresso: Boolean(destino),
            });
          return (
            <li key={a.id}>
              {destino ? (
                <a
                  href={destino}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`aviso ingresso: ${a.artista}`}
                  onClick={registrar}
                  className={classe}
                >
                  {conteudo}
                </a>
              ) : (
                <Link
                  to={`/artista/${encodeURIComponent(a.artista)}`}
                  aria-label={`aviso: ${a.artista}`}
                  onClick={registrar}
                  className={classe}
                >
                  {conteudo}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
