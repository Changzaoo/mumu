/**
 * O que a sincronia FEZ — porque "está desatualizado" é o mesmo sintoma para
 * seis falhas diferentes, e todas elas eram engolidas em silêncio.
 *
 * A cadeia entre "importei uma música aqui" e "ela aparece no outro aparelho":
 *   login → SDK do Firebase sobe → assina `users/{uid}/{coleção}` →
 *   snapshot chega → escreve na loja local → persiste no localStorage
 *
 * Cada elo tinha um `catch(() => undefined)` na saída: regra do Firestore
 * negando leitura, cota do localStorage estourada, conta errada, aparelho
 * offline — tudo terminava do mesmo jeito, sem sintoma e sem registro. O
 * aparelho simplesmente ficava para trás, e ninguém tinha como saber por quê.
 *
 * Aqui cada elo deixa um recibo. `radinhoSync()` no console imprime todos.
 */

export interface EstadoColecao {
  /** Nome da subcoleção em `users/{uid}` (library, likes, playlists…). */
  nome: string;
  /** Conta assinada agora (null = ninguém). */
  uid: string | null;
  /** Já chegou algum snapshot? */
  assinou: boolean;
  /** Quantos documentos o último snapshot trouxe. */
  docsNaNuvem: number | null;
  /** Quando o último snapshot chegou. */
  ultimoSnapshotEm: string | null;
  /** Veio do cache local ou do servidor? */
  origem: 'cache' | 'servidor' | null;
  /** Itens locais empurrados para a nuvem na união inicial. */
  enviadosNaUniao: number;
  /** Escritas que falharam desde o boot (regra, cota, rede). */
  escritasFalhas: number;
  /** A última falha, em texto — é ela que aponta a causa. */
  ultimoErro: string | null;
}

const colecoes = new Map<string, EstadoColecao>();

function estado(nome: string): EstadoColecao {
  let atual = colecoes.get(nome);
  if (!atual) {
    atual = {
      nome,
      uid: null,
      assinou: false,
      docsNaNuvem: null,
      ultimoSnapshotEm: null,
      origem: null,
      enviadosNaUniao: 0,
      escritasFalhas: 0,
      ultimoErro: null,
    };
    colecoes.set(nome, atual);
  }
  return atual;
}

export function registrarUsuario(nome: string, uid: string | null): void {
  const e = estado(nome);
  e.uid = uid;
  if (!uid) {
    e.assinou = false;
    e.docsNaNuvem = null;
    e.origem = null;
  }
}

export function registrarSnapshot(nome: string, docs: number, origem: 'cache' | 'servidor'): void {
  const e = estado(nome);
  e.assinou = true;
  e.docsNaNuvem = docs;
  e.origem = origem;
  e.ultimoSnapshotEm = new Date().toISOString();
}

export function registrarUniao(nome: string, enviados: number): void {
  estado(nome).enviadosNaUniao += enviados;
}

export function registrarErro(nome: string, erro: unknown): void {
  const e = estado(nome);
  e.escritasFalhas += 1;
  e.ultimoErro = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
}

/** Falha ao persistir a biblioteca no localStorage (cota, modo privado). */
let erroPersistencia: string | null = null;
let falhasPersistencia = 0;
export function registrarFalhaDePersistencia(erro: unknown): void {
  falhasPersistencia += 1;
  erroPersistencia = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro);
}

export interface RelatorioSync {
  colecoes: EstadoColecao[];
  /** Quantas vezes o registro local não coube no localStorage. */
  falhasDePersistencia: number;
  erroDePersistencia: string | null;
}

export function relatorioSync(): RelatorioSync {
  return {
    colecoes: [...colecoes.values()],
    falhasDePersistencia: falhasPersistencia,
    erroDePersistencia: erroPersistencia,
  };
}

/**
 * O mesmo relatório em TEXTO, para a página /diagnostico.
 *
 * O console resolve para quem tem F12; o aparelho que fica para trás é quase
 * sempre um celular, onde não existe F12. Um diagnóstico que só funciona no
 * aparelho que está bom não diagnostica nada — a mesma lição do diagnóstico de
 * reprodução, aplicada aqui.
 *
 * `itensLocais` é passado de fora (a página conhece a biblioteca) para este
 * módulo não depender da loja que ele mede.
 */
export function relatorioSyncTexto(itensLocais: number): string {
  const r = relatorioSync();
  const linhas: string[] = ['SINCRONIA ENTRE APARELHOS', ''];

  const biblioteca = r.colecoes.find((c) => c.nome === 'library');
  if (!biblioteca || !biblioteca.uid) {
    linhas.push('✗ Ninguém logado neste aparelho.');
    linhas.push('  Sem conta, nada sincroniza: a biblioteca daqui fica só aqui.');
    linhas.push('  Entre com a MESMA conta usada nos outros aparelhos.');
    return linhas.join('\n');
  }

  linhas.push(`conta: ${biblioteca.uid}`);
  linhas.push(`faixas neste aparelho: ${itensLocais}`);
  linhas.push('');

  for (const c of r.colecoes) {
    if (!c.assinou) {
      linhas.push(`✗ ${c.nome}: nenhum snapshot chegou.`);
      linhas.push(`  ${c.ultimoErro ?? 'sem erro registrado — provavelmente sem rede'}`);
      continue;
    }
    const origem = c.origem === 'cache' ? 'cache do aparelho' : 'servidor';
    linhas.push(`✓ ${c.nome}: ${c.docsNaNuvem} na nuvem (${origem}, ${c.ultimoSnapshotEm})`);
    if (c.enviadosNaUniao > 0) {
      linhas.push(`  ${c.enviadosNaUniao} item(ns) daqui foram enviados para a nuvem`);
    }
    if (c.escritasFalhas > 0) {
      linhas.push(`  ⚠ ${c.escritasFalhas} falha(s): ${c.ultimoErro}`);
    }
  }

  if (biblioteca.docsNaNuvem !== null && biblioteca.docsNaNuvem > itensLocais) {
    linhas.push('');
    linhas.push(
      `⚠ A nuvem tem ${biblioteca.docsNaNuvem} faixas e este aparelho mostra ${itensLocais}.`,
    );
    linhas.push('  O snapshot chegou mas não foi aplicado — veja as falhas acima.');
  }

  if (r.falhasDePersistencia > 0) {
    linhas.push('');
    linhas.push(`✗ O navegador recusou ${r.falhasDePersistencia} gravação(ões) do registro:`);
    linhas.push(`  ${r.erroDePersistencia}`);
    linhas.push('  Este aparelho perde a biblioteca a cada recarga (cota cheia ou aba anônima).');
  }

  return linhas.join('\n');
}

/**
 * `radinhoSync()` no console: por que ESTE aparelho está (ou não está) em dia.
 *
 * A leitura é direta — se `uid` é null, ninguém está logado e nada sincroniza;
 * se `assinou` é false, o snapshot nunca chegou (regra ou rede); se
 * `docsNaNuvem` é menor que a biblioteca local, quem está atrás é a nuvem; se
 * `erroDePersistencia` está preenchido, a cota do navegador estourou e o
 * aparelho perde tudo a cada recarga.
 */
export function instalarSyncDiagnostico(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { radinhoSync: () => void }).radinhoSync = (): void => {
    const r = relatorioSync();
    // eslint-disable-next-line no-console -- ferramenta de console, é a saída
    console.table(r.colecoes);
    if (r.falhasDePersistencia > 0) {
      console.warn(
        `localStorage recusou ${r.falhasDePersistencia} escrita(s) do registro: ${r.erroDePersistencia}. ` +
          'A biblioteca deste aparelho não sobrevive a uma recarga.',
      );
    }
  };
}
