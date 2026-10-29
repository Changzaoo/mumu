/**
 * AS CONQUISTAS DO RADINHO.
 *
 * Cada uma é um alvo com PROGRESSO visível (a barra que falta encher é o que
 * faz a pessoa voltar — o "quase lá" do Duolingo e do Xbox). A raridade dá o
 * peso: comum se ganha na primeira semana, lendária é para poucos.
 *
 * As do topo seguem a lição do reel do dono (instagram.com/p/DemaGxdCtFh): o
 * que mais move o app é QUEM JÁ OUVE voltar amanhã — por isso a maioria fala
 * de dias seguidos e de hábito, não de volume.
 */
import type { NomeDeDesenho } from '@/components/icones/Desenho';
import type { EstadoJornada } from './jornada';
import { diaDaSemana, somarDias } from './datas';

export type Raridade = 'comum' | 'rara' | 'epica' | 'lendaria';

export interface ContextoDasConquistas {
  estado: EstadoJornada;
  curtidas: number;
  playlists: number;
}

export interface Conquista {
  id: string;
  nome: string;
  descricao: string;
  icone: NomeDeDesenho;
  raridade: Raridade;
  xp: number;
  grupo: 'Sequência' | 'Hábito' | 'Escuta' | 'Exploração' | 'Amigos' | 'Liga' | 'Coleção';
  /** [quanto já tem, quanto precisa]. */
  progresso: (c: ContextoDasConquistas) => [number, number];
}

const XP_POR_RARIDADE: Record<Raridade, number> = {
  comum: 20,
  rara: 50,
  epica: 120,
  lendaria: 300,
};

export const NOME_DA_RARIDADE: Record<Raridade, string> = {
  comum: 'Comum',
  rara: 'Rara',
  epica: 'Épica',
  lendaria: 'Lendária',
};

const horas = (e: EstadoJornada): number =>
  Math.floor(Object.values(e.dias).reduce((t, s) => t + s, 0) / 3600);

/** Fins de semana (sábado + domingo) com a meta batida nos dois dias. */
function finsDeSemanaCompletos(e: EstadoJornada): number {
  const meta = e.metaMin * 60;
  let n = 0;
  for (const [dia, seg] of Object.entries(e.dias)) {
    if (diaDaSemana(dia) !== 6 || seg < meta) continue;
    if ((e.dias[somarDias(dia, 1)] ?? 0) >= meta) n++;
  }
  return n;
}

function c(
  id: string,
  nome: string,
  descricao: string,
  icone: NomeDeDesenho,
  raridade: Raridade,
  grupo: Conquista['grupo'],
  progresso: Conquista['progresso'],
): Conquista {
  return { id, nome, descricao, icone, raridade, grupo, progresso, xp: XP_POR_RARIDADE[raridade] };
}

const seq =
  (alvo: number) =>
  (x: ContextoDasConquistas): [number, number] => [
    Math.max(x.estado.recorde, x.estado.sequencia),
    alvo,
  ];

export const CONQUISTAS: Conquista[] = [
  c(
    'primeira-faixa',
    'Dei o play',
    'Ouviu a primeira música no radinho.',
    'play',
    'comum',
    'Escuta',
    (x) => [x.estado.faixas, 1],
  ),
  c(
    'meta-batida',
    'Meta batida',
    'Cumpriu a meta do dia pela primeira vez.',
    'alvo',
    'comum',
    'Hábito',
    (x) => [Object.values(x.estado.dias).some((s) => s >= x.estado.metaMin * 60) ? 1 : 0, 1],
  ),
  c('seq-3', 'Acendeu', '3 dias seguidos ouvindo.', 'chama', 'comum', 'Sequência', seq(3)),
  c(
    'seq-7',
    'Semana de fogo',
    '7 dias seguidos. Agora vira hábito.',
    'chama',
    'rara',
    'Sequência',
    seq(7),
  ),
  c(
    'seq-14',
    'Quinzena acesa',
    '14 dias seguidos sem deixar a chama apagar.',
    'chama',
    'rara',
    'Sequência',
    seq(14),
  ),
  c(
    'seq-30',
    'Mês em chamas',
    '30 dias seguidos. Pouca gente chega aqui.',
    'cometa',
    'epica',
    'Sequência',
    seq(30),
  ),
  c(
    'seq-100',
    'Centenário',
    '100 dias seguidos de radinho.',
    'cem',
    'epica',
    'Sequência',
    seq(100),
  ),
  c(
    'seq-365',
    'Um ano no ar',
    '365 dias seguidos. Lenda.',
    'coroa',
    'lendaria',
    'Sequência',
    seq(365),
  ),
  c(
    'protetor',
    'Salvo pelo gongo',
    'Um protetor segurou sua sequência num dia sem música.',
    'escudo',
    'comum',
    'Hábito',
    (x) => [x.estado.protegidos.length, 1],
  ),
  c(
    'fim-de-semana',
    'Fim de semana sonoro',
    'Bateu a meta no sábado e no domingo.',
    'confete',
    'comum',
    'Hábito',
    (x) => [finsDeSemanaCompletos(x.estado), 1],
  ),
  c(
    'coruja',
    'Coruja da madrugada',
    'Ouviu música entre meia-noite e 5 da manhã.',
    'coruja',
    'rara',
    'Hábito',
    (x) => [x.estado.madrugada ? 1 : 0, 1],
  ),
  c(
    'galo',
    'Galo do radinho',
    'Começou o dia com música antes das 7.',
    'galo',
    'rara',
    'Hábito',
    (x) => [x.estado.cedo ? 1 : 0, 1],
  ),
  c(
    'retorno',
    'O retorno',
    'Voltou depois de uma semana fora. A gente sentiu falta.',
    'maos-coracao',
    'rara',
    'Hábito',
    (x) => [x.estado.voltas, 1],
  ),
  c(
    'horas-1',
    'Primeira hora',
    '1 hora de música no total.',
    'cronometro',
    'comum',
    'Escuta',
    (x) => [horas(x.estado), 1],
  ),
  c('horas-10', 'Ouvido treinado', '10 horas de música.', 'fone', 'rara', 'Escuta', (x) => [
    horas(x.estado),
    10,
  ]),
  c('horas-100', 'Maratonista', '100 horas de música.', 'corredor', 'epica', 'Escuta', (x) => [
    horas(x.estado),
    100,
  ]),
  c(
    'horas-1000',
    'Mil horas',
    '1.000 horas. Você É o radinho.',
    'galaxia',
    'lendaria',
    'Escuta',
    (x) => [horas(x.estado), 1000],
  ),
  c('faixas-100', 'Cem faixas', '100 músicas ouvidas.', 'disco', 'comum', 'Escuta', (x) => [
    x.estado.faixas,
    100,
  ]),
  c('faixas-1000', 'Discoteca', '1.000 músicas ouvidas.', 'disco-ouro', 'epica', 'Escuta', (x) => [
    x.estado.faixas,
    1000,
  ]),
  c(
    'artistas-25',
    'Explorador',
    'Ouviu 25 artistas diferentes.',
    'bussola',
    'comum',
    'Exploração',
    (x) => [x.estado.artistas.length, 25],
  ),
  c(
    'artistas-100',
    'Enciclopédia',
    'Ouviu 100 artistas diferentes.',
    'livros',
    'epica',
    'Exploração',
    (x) => [x.estado.artistas.length, 100],
  ),
  c('generos-5', 'Eclético', 'Passeou por 5 gêneros.', 'arco-iris', 'rara', 'Exploração', (x) => [
    x.estado.generos.length,
    5,
  ]),
  c('curtidas-50', 'Coração aberto', 'Curtiu 50 músicas.', 'coracao', 'rara', 'Coleção', (x) => [
    x.curtidas,
    50,
  ]),
  c('playlist', 'Curador', 'Criou a primeira playlist.', 'pasta', 'comum', 'Coleção', (x) => [
    x.playlists,
    1,
  ]),
  c(
    'amigo-1',
    'Libertador',
    'Tirou 1 amigo dos anúncios e do streaming pago.',
    'pomba',
    'rara',
    'Amigos',
    (x) => [x.estado.amigos, 1],
  ),
  c('amigo-5', 'Revolucionário', 'Libertou 5 amigos.', 'punho', 'epica', 'Amigos', (x) => [
    x.estado.amigos,
    5,
  ]),
  c(
    'amigo-25',
    'Movimento',
    'Libertou 25 amigos. Isso é um movimento.',
    'megafone',
    'lendaria',
    'Amigos',
    (x) => [x.estado.amigos, 25],
  ),
  c('liga-ouro', 'Liga Ouro', 'Subiu até a Liga Ouro.', 'medalha-1', 'rara', 'Liga', (x) => [
    x.estado.liga,
    2,
  ]),
  c(
    'liga-diamante',
    'Diamante',
    'Chegou à Liga Diamante, o topo.',
    'diamante',
    'lendaria',
    'Liga',
    (x) => [x.estado.liga, 5],
  ),
];

export const CONQUISTA_POR_ID = new Map(CONQUISTAS.map((q) => [q.id, q]));
