/**
 * "Ficha técnica" na página do artista: gravadora/selo/editora/empresário do
 * próprio artista e quem mais aparece nos créditos das faixas dele no acervo
 * (produtores, compositores…), cada um com link para a própria página.
 */
import type { ReactNode } from 'react';
import { Briefcase, Users } from 'lucide-react';
import { NomeCreditado } from '@/components/media/CreditosDaFaixa';
import {
  PAPEIS_DE_PESSOA,
  porPapel,
  ROTULO_DO_PAPEL,
  useFichaTecnica,
  type Colaborador,
} from '@/lib/mundo/creditos';

function Titulo({ icone: Icone, children }: { icone: typeof Users; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-fg-muted">
      <Icone className="size-4" /> {children}
    </h3>
  );
}

export function FichaTecnica({ artista, ligado = true }: { artista: string; ligado?: boolean }) {
  const { data } = useFichaTecnica(artista, ligado);
  if (!data) return null;
  const doArtista = porPapel(data.doArtista);
  const colaboradores = data.colaboradores.filter((c) => PAPEIS_DE_PESSOA.has(c.papel));
  const empresas = data.colaboradores.filter((c) => !PAPEIS_DE_PESSOA.has(c.papel));
  if (doArtista.length + colaboradores.length + empresas.length === 0) return null;

  const grupo = (lista: Colaborador[]) => {
    const por = new Map<string, Colaborador[]>();
    for (const c of lista) por.set(c.papel, [...(por.get(c.papel) ?? []), c]);
    return [...por.entries()];
  };

  return (
    <section aria-label="Ficha técnica" className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-fg">Ficha técnica</h2>
        <p className="text-[12px] text-fg-subtle">
          {data.faixasLidas} de {data.faixasNoAcervo} faixas com créditos lidos · MusicBrainz,
          Discogs e o acervo
        </p>
      </div>
      {doArtista.length > 0 && (
        <div className="space-y-1">
          <Titulo icone={Briefcase}>Do artista</Titulo>
          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
            {doArtista.map((g) => (
              <div key={g.papel} className="flex gap-2">
                <dt className="shrink-0 text-fg-subtle">{ROTULO_DO_PAPEL[g.papel]}</dt>
                <dd className="min-w-0 text-fg">
                  {g.nomes.map((c, i) => (
                    <span key={c.chave}>
                      {i > 0 && ', '}
                      <NomeCreditado credito={c} />
                      {typeof c.dados?.inicio === 'string' && (
                        <span className="text-fg-subtle">
                          {' '}
                          ({String(c.dados.inicio).slice(0, 4)}
                          {typeof c.dados?.fim === 'string'
                            ? `–${String(c.dados.fim).slice(0, 4)}`
                            : '–'}
                          )
                        </span>
                      )}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {(colaboradores.length > 0 || empresas.length > 0) && (
        <div className="space-y-1">
          <Titulo icone={Users}>Quem trabalha com {data.artista}</Titulo>
          <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
            {[...grupo(colaboradores), ...grupo(empresas)].map(([papel, lista]) => (
              <div key={papel} className="flex gap-2">
                <dt className="shrink-0 text-fg-subtle">
                  {ROTULO_DO_PAPEL[papel as Colaborador['papel']]}
                </dt>
                <dd className="min-w-0 text-fg">
                  {lista.slice(0, 6).map((c, i) => (
                    <span key={c.chave}>
                      {i > 0 && ', '}
                      <NomeCreditado credito={{ ...c, fonte: 'acervo', dados: null }} />
                      {c.faixas > 1 && <span className="text-fg-subtle"> ({c.faixas})</span>}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
