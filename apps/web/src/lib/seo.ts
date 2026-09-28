/**
 * SEO — o que o buscador (e a prévia de link) lê de cada página.
 *
 * O app é uma SPA: o HTML que chega é o mesmo `index.html` para toda URL. O
 * Google executa o JavaScript antes de indexar, então basta que CADA rota
 * reescreva título, descrição e canonical na hora em que monta. Antes todas as
 * páginas se chamavam "radinho.online" — para o buscador, milhares de URLs com
 * o mesmo título e a mesma descrição, que ele trata como duplicatas.
 *
 * As tags mexidas aqui já existem no `index.html` (com os valores da Home);
 * este módulo só troca o conteúdo, nunca empilha tags novas.
 */
export const SITE = 'radinho.online';
export const ORIGEM = 'https://radinho.online';

export const DESCRICAO_PADRAO =
  'Ouça música online grátis no radinho.online: milhares de músicas de funk, rap, pop, rock, MPB, sertanejo e trap, rádios ao vivo e podcasts. Sem cadastro, direto no navegador.';

export interface Seo {
  /** Título da página SEM o sufixo da marca. `null` = só a marca (Home). */
  titulo: string | null;
  descricao?: string;
  /** Caminho canônico (sem query). */
  caminho: string;
  /** Páginas pessoais (biblioteca, curtidas…) não interessam ao buscador. */
  indexar?: boolean;
}

function meta(atributo: 'name' | 'property', chave: string, valor: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${atributo}="${chave}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(atributo, chave);
    document.head.appendChild(el);
  }
  el.content = valor;
}

export function tituloCompleto(titulo: string | null): string {
  return titulo ? `${titulo} | ${SITE}` : `${SITE} — Ouça música online grátis`;
}

export function aplicarSeo({ titulo, descricao, caminho, indexar = true }: Seo): void {
  const completo = tituloCompleto(titulo);
  const desc = descricao ?? DESCRICAO_PADRAO;
  const url = ORIGEM + caminho;

  document.title = completo;
  meta('name', 'description', desc);
  meta('name', 'robots', indexar ? 'index, follow, max-image-preview:large' : 'noindex, follow');
  meta('property', 'og:title', completo);
  meta('property', 'og:description', desc);
  meta('property', 'og:url', url);
  meta('name', 'twitter:title', completo);
  meta('name', 'twitter:description', desc);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = url;
}

/** Nome vindo da URL (`/artista/GR6%20EXPLODE`) — decodificado e tolerante. */
function nomeDaUrl(segmento: string): string {
  try {
    return decodeURIComponent(segmento).trim();
  } catch {
    return segmento.trim();
  }
}

type Regra = (partes: string[]) => Omit<Seo, 'caminho'>;

/** Páginas pessoais ou de gestão: existem para quem está usando, não para
 *  busca. O título continua importando — é o que aparece na aba. */
const PRIVADAS: Record<string, string> = {
  library: 'Sua biblioteca',
  liked: 'Músicas curtidas',
  history: 'Tocadas recentemente',
  downloads: 'Downloads',
  uploads: 'Envios',
  dispositivo: 'Adicionar músicas',
  telemetria: 'Telemetria',
  diagnostico: 'Diagnóstico',
  settings: 'Configurações',
  admin: 'Administração',
  onboarding: 'Bem-vindo',
  login: 'Entrar',
  compartilhar: 'Compartilhar',
  mix: 'Mix',
  profile: 'Perfil',
  s: 'Música compartilhada',
};

const ESTATICAS: Record<string, Omit<Seo, 'caminho'>> = {
  '': { titulo: null },
  search: {
    titulo: 'Buscar músicas, artistas e álbuns',
    descricao:
      'Busque qualquer música, artista, álbum ou trecho de letra e ouça na hora, grátis, no radinho.online.',
  },
  discover: {
    titulo: 'Descobrir música nova',
    descricao:
      'Descubra músicas novas e mixes montados para o seu gosto: funk, rap, pop, rock, MPB, sertanejo e muito mais. Grátis no radinho.online.',
  },
  radios: {
    titulo: 'Rádios online ao vivo',
    descricao:
      'Ouça rádios online ao vivo do Brasil e do mundo, grátis e sem cadastro, direto no navegador pelo radinho.online.',
  },
  podcasts: {
    titulo: 'Podcasts',
    descricao: 'Ouça podcasts grátis no radinho.online: episódios novos direto no navegador.',
  },
  artistas: {
    titulo: 'Artistas',
    descricao:
      'Todos os artistas do radinho.online: ouça as músicas mais populares de cada um, grátis.',
  },
  gravadoras: {
    titulo: 'Gravadoras',
    descricao: 'Músicas organizadas por gravadora no radinho.online. Ouça grátis.',
  },
};

const DINAMICAS: Record<string, Regra> = {
  artista: ([nome = '']) => ({
    titulo: `${nomeDaUrl(nome)} — músicas e álbuns`,
    descricao: `Ouça ${nomeDaUrl(nome)} online grátis: as músicas mais tocadas, álbuns e lançamentos, com letra, no radinho.online.`,
  }),
  genero: ([nome = '']) => ({
    titulo: `${nomeDaUrl(nome)} — as melhores músicas`,
    descricao: `As melhores músicas de ${nomeDaUrl(nome)} para ouvir online grátis, sem cadastro, no radinho.online.`,
  }),
  gravadora: ([nome = '']) => ({
    titulo: `${nomeDaUrl(nome)} — músicas da gravadora`,
    descricao: `Músicas lançadas pela ${nomeDaUrl(nome)} para ouvir online grátis no radinho.online.`,
  }),
  disco: ([chave = '']) => {
    // A chave é "titulo normalizado|artista normalizado".
    const [album = '', artista = ''] = nomeDaUrl(chave).split('|');
    const nome = [album, artista].filter(Boolean).join(' — ');
    return {
      titulo: nome ? `${nome} (álbum)` : 'Álbum',
      descricao: `Ouça o álbum ${nome || ''} completo online grátis no radinho.online.`,
    };
  },
  catalogo: ([tipo = '']) => ({ titulo: tipo === 'artista' ? 'Artista' : 'Playlist' }),
  playlist: () => ({ titulo: 'Playlist' }),
  album: () => ({ titulo: 'Álbum' }),
  'album-apple': () => ({ titulo: 'Álbum' }),
  artist: () => ({ titulo: 'Artista' }),
  podcast: () => ({ titulo: 'Podcast' }),
};

/** O SEO de uma URL do app. Rota desconhecida = não indexar (é a 404). */
export function seoDaRota(pathname: string): Seo {
  const caminho = pathname.replace(/\/+$/, '') || '/';
  const [primeiro = '', ...resto] = caminho.split('/').filter(Boolean);
  const privada = PRIVADAS[primeiro];
  if (privada) return { titulo: privada, caminho, indexar: false };
  const estatica = resto.length === 0 ? ESTATICAS[primeiro] : undefined;
  if (estatica) return { ...estatica, caminho };
  const dinamica = DINAMICAS[primeiro];
  if (dinamica && resto.length > 0) return { ...dinamica(resto), caminho };
  return { titulo: 'Página não encontrada', caminho, indexar: false };
}
