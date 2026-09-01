/**
 * /onboarding — a primeira pergunta depois do login: o que você ouve?
 *
 * POR QUE ESTA TELA EXISTE. A Home é montada a partir de comportamento — plays
 * com decaimento no tempo e curtidas (ver `lib/reco/generosDoGosto`). No
 * primeiro dia não há nem um nem outro, e o desempate cai no tamanho da
 * biblioteca: quem acabou de entrar via os maiores gêneros do acervo, que não
 * têm relação nenhuma com ele. Esta é a única oportunidade de saber alguma
 * coisa antes de haver o que medir.
 *
 * A REGRA QUE MANDA NO DESENHO: só se oferece o que existe no acervo.
 *
 * A tentação é mostrar uma lista bonita de gêneros do mundo — "K-pop", "Jazz",
 * "Bolero". Mas escolher um gênero que o acervo não tem produz o pior desfecho
 * possível: a pessoa responde, é levada para a Home, e a Home ignora tudo que
 * ela disse, porque não há uma faixa sequer daquilo. A pergunta vira teatro. Por
 * isso gêneros e artistas saem de `localLibrary` — do que dá para tocar hoje.
 *
 * A consequência incômoda é que a tela depende de o acervo já ter chegado. Ela
 * assume isso em vez de fingir: enquanto não chegou, mostra que está buscando e
 * mantém a saída aberta.
 *
 * FOTO DE ARTISTA FICA DE FORA DE PROPÓSITO. `useArtistImage` dispara uma busca
 * de rede por nome ainda não cacheado; numa grade de dezenas de artistas isso
 * seriam dezenas de requisições na PRIMEIRA tela depois do login, competindo
 * com o download do acervo — justamente o que faz a primeira música demorar.
 * Aqui se usa a capa que a biblioteca já tem em mãos, de graça.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { Check, Loader2, Music2 } from 'lucide-react';
import { GENRE_TAXONOMY } from '@radinho/shared';
import { RadinhoLogo } from '@/components/brand/RadinhoMark';
import { Button } from '@/components/ui/button';
import * as gostoInicial from '@/lib/local/gostoInicial';
import * as localLibrary from '@/lib/local/localLibrary';
import { cn } from '@/lib/utils';

const VAZIO: localLibrary.LibraryEntry[] = [];

/**
 * Quantos cartões cada passo mostra.
 *
 * Não é um limite de desempenho — é de decisão. Uma grade com os 300 artistas
 * do acervo não é mais generosa que uma com 48; é uma tela que ninguém termina
 * de ler, e o resultado prático é a pessoa pular. Os cortes são pelos MAIORES,
 * então o que fica de fora é sempre a cauda longa.
 *
 * O RACIOCÍNIO NÃO VALE PARA GÊNERO, e um número fixo aqui apagava categorias.
 * Artista é lista aberta — o acervo tem centenas, e cortar na cauda é a única
 * saída. Gênero é lista FECHADA (`GENRE_TAXONOMY`): o vocabulário inteiro cabe
 * numa tela, e cada corte não tira "mais um card", tira um estilo do mapa. O
 * número fixo (24) estava um abaixo da taxonomia, então o menor gênero do
 * acervo sumia do onboarding sem que nada indicasse isso — e o menor é sempre o
 * recém-chegado, justamente quem mais precisa ser oferecido para crescer.
 * Amarrar ao tamanho da taxonomia faz o teto acompanhar sozinho o próximo
 * gênero que entrar.
 */
const MAX_GENEROS = GENRE_TAXONOMY.length;
const MAX_ARTISTAS = 48;

type Passo = 'generos' | 'artistas';

function Cartao({
  titulo,
  imagem,
  redondo,
  marcado,
  onClick,
}: {
  titulo: string;
  imagem: string | null;
  redondo?: boolean;
  marcado: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={marcado}
      className={cn(
        'group flex flex-col items-center gap-2 rounded-xl p-2 text-center transition-colors',
        marcado ? 'bg-accent/15' : 'hover:bg-fg/5',
      )}
    >
      <div
        className={cn(
          'relative w-full overflow-hidden bg-bg-overlay',
          redondo ? 'aspect-square rounded-full' : 'aspect-square rounded-lg',
          // A borda é o que comunica a escolha à distância; o fundo sozinho
          // some em tela de brilho baixo e no modo de alto contraste.
          marcado ? 'ring-2 ring-accent' : 'ring-1 ring-fg/10',
        )}
      >
        {imagem ? (
          <img
            src={imagem}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-fg-muted">
            <Music2 className="size-6" aria-hidden />
          </div>
        )}
        {marcado && (
          <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-accent text-accent-fg">
            <Check className="size-4" aria-hidden />
          </span>
        )}
      </div>
      <span className="line-clamp-2 text-[13px] font-medium leading-tight text-fg">{titulo}</span>
    </button>
  );
}

export default function OnboardingPage() {
  const navigate = useNavigate();
  const entries = useSyncExternalStore(localLibrary.subscribe, localLibrary.list, () => VAZIO);

  const [passo, setPasso] = useState<Passo>('generos');
  const [generos, setGeneros] = useState<string[]>([]);
  const [artistas, setArtistas] = useState<string[]>([]);

  const todosGeneros = useMemo(
    () => localLibrary.genreGroups().slice(0, MAX_GENEROS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fonte reativa
    [entries],
  );

  /**
   * Os artistas do passo 2, PRIORIZADOS pelos gêneros do passo 1.
   *
   * Sem isso o segundo passo ignoraria o primeiro: quem escolheu "samba"
   * receberia a mesma grade genérica dos maiores artistas do acervo, e a
   * sensação seria de que a primeira resposta não foi ouvida. Quem toca o
   * gênero escolhido vem antes; o resto continua disponível abaixo, porque
   * gênero atribuído por IA erra e ninguém deve ficar sem achar quem procura.
   */
  const todosArtistas = useMemo(() => {
    const escolhidos = new Set(generos.map((g) => g.toLowerCase()));
    const doGenero = new Set<string>();
    if (escolhidos.size > 0) {
      for (const g of localLibrary.genreGroups()) {
        if (!escolhidos.has(g.genre.toLowerCase())) continue;
        for (const t of g.tracks) for (const a of t.artists) if (a.name) doGenero.add(a.name);
      }
    }
    const lista = localLibrary.artists();
    const dentro = lista.filter((a) => doGenero.has(a.name));
    const fora = lista.filter((a) => !doGenero.has(a.name));
    return [...dentro, ...fora].slice(0, MAX_ARTISTAS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fonte reativa
  }, [entries, generos]);

  const alternar = (lista: string[], valor: string): string[] =>
    lista.includes(valor) ? lista.filter((x) => x !== valor) : [...lista, valor];

  const concluir = (): void => {
    gostoInicial.salvar(generos, artistas);
    void navigate('/', { replace: true });
  };

  const pular = (): void => {
    gostoInicial.pular();
    void navigate('/', { replace: true });
  };

  const carregando = entries.length === 0;
  const noPasso1 = passo === 'generos';
  const itens = noPasso1 ? todosGeneros.length : todosArtistas.length;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 size-[36rem] rounded-full bg-accent opacity-20 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-40 size-[36rem] rounded-full bg-info opacity-15 blur-[120px]"
      />

      {/* O SCROLLER É DAQUI, e ele não é opcional.
          No toque o documento inteiro é FIXO de propósito (globals.css, dentro
          de `@media (pointer: coarse)`: html e body viram `position: fixed` com
          `overflow: hidden`, para matar o rubber-band do navegador). Quem rola
          no app são os contêineres internos — na casca, o main. Esta tela mora
          FORA da casca, então precisa oferecer o seu: sem isso a grade
          transborda e fica inalcançável no celular. No desktop nada disso
          aparece, porque a regra vale só para ponteiro grosso — foi por isso
          que passou batido. */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-y-none">
        <header className="mx-auto w-full max-w-4xl px-5 pb-4 pt-8">
          <RadinhoLogo />
          <p className="mt-6 text-[13px] font-medium uppercase tracking-wide text-fg-muted">
            Passo {noPasso1 ? 1 : 2} de 2
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-fg sm:text-3xl">
            {noPasso1 ? 'O que você gosta de ouvir?' : 'Escolha alguns artistas'}
          </h1>
          <p className="mt-2 max-w-prose text-sm text-fg-muted">
            {noPasso1
              ? 'Escolha os estilos que combinam com você. Serve para a primeira tela já fazer sentido — depois ela se ajusta sozinha ao que você realmente ouvir.'
              : 'Quem você escolher aqui ganha uma prateleira própria na Home. Pode deixar em branco se não reconhecer ninguém.'}
          </p>
        </header>

        <main className="mx-auto w-full max-w-4xl px-5 pb-8">
          {carregando ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center text-sm text-fg-muted">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              Carregando o acervo…
            </div>
          ) : itens === 0 ? (
            // O acervo chegou e não há o que oferecer. Dizer isso é melhor que uma
            // grade vazia com um botão desabilitado, que parece defeito.
            <p className="py-20 text-center text-sm text-fg-muted">
              Ainda não há {noPasso1 ? 'gêneros' : 'artistas'} suficientes no acervo para escolher.
              Você pode seguir e voltar a isto depois.
            </p>
          ) : noPasso1 ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {todosGeneros.map((g) => (
                <Cartao
                  key={g.genre}
                  titulo={g.genre}
                  imagem={g.coverUrl}
                  marcado={generos.includes(g.genre)}
                  onClick={() => setGeneros((atual) => alternar(atual, g.genre))}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {todosArtistas.map((a) => (
                <Cartao
                  key={a.name}
                  titulo={a.name}
                  imagem={a.coverUrl}
                  redondo
                  marcado={artistas.includes(a.name)}
                  onClick={() => setArtistas((atual) => alternar(atual, a.name))}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* A barra fica sempre à vista porque a grade rola: sem isso, quem
          escolhesse um gênero lá em cima teria de rolar até o fim para
          descobrir como seguir.

          Ela NÃO é `fixed` — é a última linha do layout, a mesma lição que o
          PlayerBar aprendeu na casca. `fixed` dentro de um body que já é
          `position: fixed` no toque se ancora na janela, não no quadro do app,
          e escorrega quando o teclado abre ou a barra do navegador se recolhe.
          O `env(safe-area-inset-bottom)` mantém os botões acima do indicador de
          home do iPhone. */}
      <footer className="glass relative z-20 shrink-0 border-t border-fg/10 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <Button variant="ghost" onClick={noPasso1 ? pular : () => setPasso('generos')}>
            {noPasso1 ? 'Agora não' : 'Voltar'}
          </Button>
          <div className="flex items-center gap-3">
            <span aria-live="polite" className="text-xs text-fg-muted">
              {noPasso1
                ? generos.length === 0
                  ? 'Escolha ao menos um'
                  : `${generos.length} ${generos.length === 1 ? 'estilo' : 'estilos'}`
                : `${artistas.length} ${artistas.length === 1 ? 'artista' : 'artistas'}`}
            </span>
            <Button
              variant="accent"
              // Sem gênero nenhum não há o que semear, e seguir daria a impressão
              // de que a resposta foi registrada. Quem não quer escolher tem o
              // "Agora não" ao lado, que é explícito. A trava não se aplica
              // quando não há gênero A OFERECER — aí o passo é intransponível.
              disabled={noPasso1 && generos.length === 0 && todosGeneros.length > 0}
              onClick={noPasso1 ? () => setPasso('artistas') : concluir}
            >
              {noPasso1 ? 'Continuar' : 'Pronto'}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
