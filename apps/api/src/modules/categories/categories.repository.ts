import { prisma } from '../../infra/db/prisma.js';
import {
  classificarFaixa,
  familiaDoGenero,
  ehFamiliaSensivel,
  type FamiliaDeGenero,
  type VeredictoDeConteudo,
} from '@radinho/shared';

export interface FamiliaDto {
  slug: FamiliaDeGenero;
  nome: string;
  descricao: string;
  /** Aliasado a `tracks`: contagem real de faixas públicas nesta família. */
  qtdEstimada: number;
  tracks: number;
  conteudoVeredicto: VeredictoDeConteudo;
  /** `true` quando a família recebe as regras extras de convivência. */
  sensivel: boolean;
}

/**
 * Metadados de apresentação das famílias.
 *
 * O mapeamento gênero → família vive em `familiasDeGenero.ts` (shared) e é a
 * única fonte de verdade da curadoria. Aqui só guardamos nome e descrição
 * para a vitrine — mudar a coerência é mudar lá, não aqui.
 */
const METADADOS: Readonly<Record<FamiliaDeGenero, { nome: string; descricao: string }>> = {
  devocional: { nome: 'Devocional', descricao: 'Gospel e louvor.' },
  urbano: { nome: 'Urbano', descricao: 'Funk, trap e hip-hop.' },
  sertanejo: { nome: 'Sertanejo e Forró', descricao: 'Sertanejo, forró e country.' },
  samba: { nome: 'Samba e Pagode', descricao: 'Samba, pagode e axé.' },
  mpb: { nome: 'MPB', descricao: 'Música popular brasileira.' },
  rock: { nome: 'Rock', descricao: 'Rock, metal e indie.' },
  eletronica: { nome: 'Eletrônica', descricao: 'Eletrônica e dance.' },
  soul: { nome: 'Soul e Jazz', descricao: 'R&B, soul, jazz e blues.' },
  latino: { nome: 'Latino', descricao: 'Reggae, reggaeton e latina.' },
  pop: { nome: 'Pop', descricao: 'Pop e K-pop.' },
  classica: { nome: 'Clássica', descricao: 'Música erudita.' },
  ambiente: { nome: 'Ambiente', descricao: 'Lo-fi para ouvir de fundo.' },
};

const ORDEM: readonly FamiliaDeGenero[] = [
  'devocional',
  'urbano',
  'sertanejo',
  'samba',
  'mpb',
  'rock',
  'eletronica',
  'soul',
  'latino',
  'pop',
  'classica',
  'ambiente',
];

interface AmostraDeFaixa {
  title: string;
  explicit: boolean;
}

export const categoriesRepository = {
  /**
   * Lista as famílias de gêneros com contagem real de faixas públicas.
   *
   * O agrupamento é feito em memória via `familiaDoGenero` (shared): os
   * gêneros do banco são carregados com suas faixas e cada faixa cai na
   * família do seu primeiro gênero. Faixas sem gênero conhecido ficam de
   * fora — na dúvida, contra mostrar (mesma regra das famílias sensíveis).
   */
  async list(): Promise<FamiliaDto[]> {
    const generos = await prisma.genre.findMany({
      select: {
        name: true,
        tracks: {
          select: {
            track: {
              select: {
                title: true,
                explicit: true,
                isPublic: true,
              },
            },
          },
        },
      },
    });

    const porFamilia = new Map<FamiliaDeGenero, AmostraDeFaixa[]>();
    for (const genero of generos) {
      const familia = familiaDoGenero(genero.name);
      if (familia === null) continue;
      const faixas = porFamilia.get(familia) ?? [];
      for (const { track } of genero.tracks) {
        if (track.isPublic) faixas.push({ title: track.title, explicit: track.explicit });
      }
      porFamilia.set(familia, faixas);
    }

    return ORDEM.filter((familia) => (porFamilia.get(familia)?.length ?? 0) > 0).map(
      (familia): FamiliaDto => {
        const faixas = porFamilia.get(familia) ?? [];
        const meta = METADADOS[familia];
        return {
          slug: familia,
          nome: meta.nome,
          descricao: meta.descricao,
          qtdEstimada: faixas.length,
          tracks: faixas.length,
          conteudoVeredicto: veredictoDaFamilia(faixas),
          sensivel: ehFamiliaSensivel(familia),
        };
      },
    );
  },
};

/**
 * O veredito agregado da família.
 *
 * Faixa com selo `explicit` é condenação imediata. Sem selo, julgamos o
 * título pelo léxico do shared — e sem título julgável a faixa conta como
 * desconhecida, não como limpa.
 */
function veredictoDaFamilia(faixas: AmostraDeFaixa[]): VeredictoDeConteudo {
  if (faixas.length === 0) return 'desconhecido';
  let temDesconhecido = false;
  for (const faixa of faixas) {
    if (faixa.explicit) return 'explicito';
    const { veredicto } = classificarFaixa({ titulo: faixa.title });
    if (veredicto === 'explicito') return 'explicito';
    if (veredicto === 'desconhecido') temDesconhecido = true;
  }
  return temDesconhecido ? 'desconhecido' : 'limpo';
}
