/**
 * O QUE CADA IDADE PODE OUVIR — a regra única que o player, as listas e as
 * recomendações consultam.
 *
 * Uma criança que ouve K-pop não pode esbarrar em rap com palavrão. O app já
 * sabia JULGAR uma faixa (`classificarTexto`/`classificarFaixa`, no shared:
 * letra + título → explícito | limpo | desconhecido); faltava saber QUEM ESTÁ
 * OUVINDO e aplicar isso em todo lugar que mostra ou toca música.
 *
 *   • criança (< 13): só o COMPROVADAMENTE limpo. "Desconhecido" (sem letra
 *     para julgar) fica de fora — "não sei" não é "está limpo";
 *   • adolescente (13–17): nada explícito;
 *   • idade desconhecida: a regra do adolescente, até a pessoa responder
 *     (a pergunta aparece ao entrar — ver `PerguntaDeIdade`);
 *   • adulto (18+): tudo.
 *
 * De onde vem o veredito de uma faixa, do mais forte para o mais fraco:
 *   1. o que o próprio aparelho julgou na LETRA que baixou (`registrarLetra`)
 *      — mais recente que o do servidor quando ele ainda não tinha letra;
 *   2. o veredito do servidor na entrada do acervo (`conteudoVeredicto`);
 *   3. o TÍTULO (um título com palavrão já condena; título limpo não prova
 *      nada — continua desconhecido).
 */
import { useSyncExternalStore } from 'react';
import { classificarFaixa, classificarTexto, type VeredictoDeConteudo } from '@radinho/shared';
import type { TrackDto } from '@radinho/shared';
import * as localLibrary from '@/lib/local/localLibrary';
import { useSettingsStore } from '@/stores/settingsStore';

export type FaixaEtaria = 'crianca' | 'adolescente' | 'adulto' | 'desconhecida';

/** "AAAA-MM" → faixa etária hoje. Inválido/ausente → desconhecida. */
export function faixaEtariaDe(
  dataNascimento: string | null | undefined,
  agora = new Date(),
): FaixaEtaria {
  const m = /^(\d{4})-(\d{2})$/.exec(dataNascimento ?? '');
  if (!m) return 'desconhecida';
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 1900 || ano > agora.getFullYear()) return 'desconhecida';
  let idade = agora.getFullYear() - ano;
  if (agora.getMonth() + 1 < mes) idade -= 1; // ainda não fez aniversário este ano
  if (idade < 13) return 'crianca';
  if (idade < 18) return 'adolescente';
  return 'adulto';
}

/** A regra, pura: esta faixa etária pode ouvir algo com este veredito? */
export function permitidoPara(faixa: FaixaEtaria, veredicto: VeredictoDeConteudo): boolean {
  if (faixa === 'adulto') return true;
  if (faixa === 'crianca') return veredicto === 'limpo';
  return veredicto !== 'explicito'; // adolescente e desconhecida
}

// ── vereditos que o aparelho tirou da letra ────────────────────────────
const daLetra = new Map<string, VeredictoDeConteudo>();
const ouvintes = new Set<() => void>();
let versao = 0;

function avisar(): void {
  versao++;
  for (const o of ouvintes) o();
}

/** Para `useSyncExternalStore`: muda quando a idade ou um veredito muda. */
export function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  const desligarAjustes = useSettingsStore.subscribe((s, a) => {
    if (s.dataNascimento !== a.dataNascimento) ouvinte();
  });
  return () => {
    ouvintes.delete(ouvinte);
    desligarAjustes();
  };
}

export function versaoDoFiltro(): string {
  return `${useSettingsStore.getState().dataNascimento ?? '-'}:${versao}`;
}

/**
 * A letra de uma faixa chegou (busca de letra, transcrição): julga já. Um
 * explícito encontrado aqui vale na hora — inclusive para a música que está
 * tocando (o player escuta `assinar` e pula).
 */
export function registrarLetra(trackId: string, titulo: string, letra: string): void {
  const { veredicto } = classificarFaixa({ titulo, letra });
  if (veredicto === 'desconhecido' || daLetra.get(trackId) === veredicto) return;
  daLetra.set(trackId, veredicto);
  avisar();
}

function veredictoDaBiblioteca(id: string): VeredictoDeConteudo | undefined {
  try {
    const entrada = localLibrary.entryFor?.(id) as {
      conteudoVeredicto?: VeredictoDeConteudo;
    } | null;
    return entrada?.conteudoVeredicto;
  } catch {
    return undefined;
  }
}

export function veredictoDe(track: Pick<TrackDto, 'id' | 'title'>): VeredictoDeConteudo {
  const local = daLetra.get(track.id);
  if (local) return local;
  // Consultar a biblioteca nunca pode derrubar quem pergunta (o player, uma
  // lista): sem resposta, o veredito é "desconhecido" e a regra da idade decide.
  const doServidor = veredictoDaBiblioteca(track.id);
  if (doServidor) return doServidor;
  return tituloEhExplicito(track.title ?? '') ? 'explicito' : 'desconhecido';
}

/**
 * O julgamento do TÍTULO, memoizado pelo texto. Todo cartão de faixa pergunta
 * a cada render, e `classificarTexto` roda a lista inteira de termos em regex:
 * medido em 2026-09-28, ~630ms num celular fraco para abrir a /library. O
 * título não muda de veredito — o que muda é a letra, que tem o próprio mapa.
 */
const tituloExplicito = new Map<string, boolean>();

function tituloEhExplicito(titulo: string): boolean {
  const pronto = tituloExplicito.get(titulo);
  if (pronto !== undefined) return pronto;
  const explicito = classificarTexto(titulo).veredicto === 'explicito';
  if (tituloExplicito.size >= 20_000) tituloExplicito.clear();
  tituloExplicito.set(titulo, explicito);
  return explicito;
}

export function faixaEtariaAtual(): FaixaEtaria {
  return faixaEtariaDe(useSettingsStore.getState().dataNascimento);
}

/** A pergunta que todo mundo faz: esta pessoa pode ouvir/ver esta faixa? */
export function podeOuvir(track: Pick<TrackDto, 'id' | 'title'> | null | undefined): boolean {
  if (!track) return false;
  const faixa = faixaEtariaAtual();
  if (faixa === 'adulto') return true;
  return permitidoPara(faixa, veredictoDe(track));
}

/**
 * Para componentes: re-renderiza quando a idade ou um veredito muda (a faixa
 * some da tela na hora em que a letra explícita é descoberta).
 */
export function usePodeOuvir(track: Pick<TrackDto, 'id' | 'title'> | null | undefined): boolean {
  useSyncExternalStore(assinar, versaoDoFiltro, versaoDoFiltro);
  return podeOuvir(track);
}

/**
 * No boot: julga as letras que já estão guardadas no aparelho (centenas), em
 * pedaços, fora do caminho da primeira tela. Só vale para quem tem restrição.
 */
export async function julgarLetrasGuardadas(): Promise<void> {
  if (faixaEtariaAtual() === 'adulto') return;
  const { lyricsCacheEntries } = await import('@/lib/lyrics/lyrics');
  const entradas = lyricsCacheEntries();
  for (let i = 0; i < entradas.length; i += 25) {
    for (const [id, letra] of entradas.slice(i, i + 25)) {
      const { veredicto } = classificarFaixa({
        titulo: '',
        letra: letra.lines.map((l) => l.text).join(' '),
      });
      if (veredicto !== 'desconhecido') daLetra.set(id, veredicto);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  avisar();
}

/**
 * Pode trocar a data atual por esta? Quem está numa faixa com restrição não
 * pode, sozinho, "envelhecer" (data mais antiga = menos restrição): senão a
 * proteção seria um clique. Ficar mais novo (mais restrição) sempre pode.
 */
export function podeTrocarPara(atual: string | null, nova: string): boolean {
  const antes = faixaEtariaDe(atual);
  if (antes !== 'crianca' && antes !== 'adolescente') return true;
  return nova >= (atual ?? '');
}
