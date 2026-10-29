/**
 * O CONVITE DE UM AMIGO — `radinho.online/c/<handle>`.
 *
 * É a porta de quem chega pelo link: diz quem chamou, o que é o radinho em
 * uma frase (música de graça, sem anúncio, sem cadastro) e leva direto para
 * ouvir. O convite é guardado e entregue na hora: conta para quem chamou no
 * contador de "amigos libertados" (uma vez por aparelho).
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { api } from '@/lib/api';
import { entregarConvite, guardarConvite, PRECO_DO_STREAMING } from '@/lib/jornada/servidor';
import { Desenho } from '@/components/icones/Desenho';

interface Padrinho {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  amigos: number;
}

const VANTAGENS = [
  ['fone', 'Música de graça', 'Funk, rap, pop, sertanejo, MPB, rock e muito mais.'],
  ['sem-anuncio', 'Sem anúncio', 'Nada interrompendo a sua música.'],
  [
    'gratis',
    'Sem mensalidade',
    `Os ≈ R$ ${PRECO_DO_STREAMING.toFixed(2).replace('.', ',')} do streaming ficam no seu bolso.`,
  ],
  ['radio', 'Rádios e podcasts', 'Ao vivo, direto no navegador ou no app.'],
] as const;

export default function ConvitePage() {
  const { handle = '' } = useParams();
  const [padrinho, setPadrinho] = useState<Padrinho | null>(null);

  useEffect(() => {
    if (!handle) return;
    guardarConvite(handle);
    void entregarConvite();
    void api
      .get<Padrinho>(`/jornada/convite/${encodeURIComponent(handle)}`)
      .then(({ data }) => setPadrinho(data))
      .catch(() => undefined);
  }, [handle]);

  const nome = padrinho?.displayName ?? 'Um amigo';
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-5 py-10 text-center">
      <Avatar className="size-20 ring-4 ring-emerald-400/40">
        {padrinho?.avatarUrl && <AvatarImage src={padrinho.avatarUrl} alt="" />}
        <AvatarFallback>{nome.slice(0, 2)}</AvatarFallback>
      </Avatar>
      <h1 className="mt-5 text-3xl font-black tracking-tight">{nome} te chamou para o radinho</h1>
      <p className="mt-2 text-fg-muted">
        Larga o streaming pago e os anúncios. Aqui a música é de graça — e não precisa nem de
        cadastro.
      </p>
      {padrinho && padrinho.amigos > 0 && (
        <p className="mt-3 text-sm font-medium text-emerald-400">
          <Desenho nome="pomba" /> {nome} já libertou {padrinho.amigos}{' '}
          {padrinho.amigos === 1 ? 'amigo' : 'amigos'}. Você é o próximo.
        </p>
      )}
      <ul className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
        {VANTAGENS.map(([icone, titulo, texto]) => (
          <li key={titulo} className="rounded-2xl border border-border p-4">
            <Desenho nome={icone} className="size-7 text-accent" />
            <p className="mt-1 font-semibold">{titulo}</p>
            <p className="text-sm text-fg-muted">{texto}</p>
          </li>
        ))}
      </ul>
      <Link
        to="/"
        data-testid="aceitar-convite"
        className="mt-8 w-full rounded-full bg-emerald-400 px-6 py-3 text-base font-bold text-black"
      >
        Começar a ouvir
      </Link>
      <Link to="/login" className="mt-3 text-sm text-fg-muted underline-offset-4 hover:underline">
        Entrar com a conta Google para guardar suas músicas
      </Link>
    </div>
  );
}
