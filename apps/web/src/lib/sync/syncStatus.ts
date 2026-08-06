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

/** Foto da biblioteca deste aparelho, medida por quem a conhece (a página). */
/**
 * Quem está logado NESTE aparelho.
 *
 * Existe porque a escrita no acervo era negada por uma comparação de e-mail que
 * ninguém conseguia ver: o app dizia "não consegui publicar" e não dizia com
 * QUAL conta tinha tentado. Sessão anônima — que o app oferece — nem e-mail tem.
 * Uma linha aqui responde o que custou dias.
 */
export interface Conta {
  uid: string | null;
  email: string | null;
  anonima: boolean;
}

export interface ResumoBiblioteca {
  /** Faixas na biblioteca deste aparelho. */
  total: number;
  /** Quantas vieram do acervo do app (emprestadas). */
  doAcervo: number;
  /**
   * Faixas que NÃO tocam em nenhum aparelho além do que as importou: sem cópia
   * no importador (`remoteUrl`) e sem link de origem (`sourceUrl`). No acervo
   * elas aparecem na tela de todo mundo e não tocam para ninguém — é o segundo
   * jeito de "as músicas não chegaram", e o único que sobra depois de a
   * sincronia estar certa.
   */
  semFonteRemota: number;
}

/**
 * O mesmo relatório em TEXTO, para a página /diagnostico.
 *
 * O console resolve para quem tem F12; o aparelho que fica para trás é quase
 * sempre um celular, onde não existe F12. Um diagnóstico que só funciona no
 * aparelho que está bom não diagnostica nada — a mesma lição do diagnóstico de
 * reprodução, aplicada aqui.
 *
 * O resumo é passado de fora (a página conhece a biblioteca) para este módulo
 * não depender da loja que ele mede.
 */
export function relatorioSyncTexto(resumo: ResumoBiblioteca, conta?: Conta): string {
  const r = relatorioSync();
  const itensLocais = resumo.total;
  const linhas: string[] = ['SINCRONIA ENTRE APARELHOS', ''];

  // A CONTA VEM PRIMEIRO. Quase toda recusa de escrita se explica aqui, e sem
  // esta linha o app dizia "não consegui publicar" sem dizer com quem tentou.
  if (conta) {
    if (!conta.uid) linhas.push('conta: NENHUMA (deslogado)');
    else if (conta.anonima) {
      linhas.push(`conta: ANÔNIMA (${conta.uid})`);
      linhas.push('  Sessão anônima não tem e-mail — regra que compara e-mail nunca casa.');
    } else linhas.push(`conta: ${conta.email ?? '(sem e-mail no token)'} (${conta.uid})`);
    linhas.push('');
  }

  // O ACERVO vem primeiro, e é reportado mesmo sem login: ele é o que o app
  // tem para oferecer a quem só escuta. Acervo vazio aqui e cheio no aparelho
  // do admin significa que as regras do Firestore não foram publicadas.
  // COTA ESTOURADA derruba o projeto INTEIRO — acervo, biblioteca pessoal,
  // "em alta", compartilhamentos. Como o sintoma é "sumiu tudo", e não "o
  // Firebase está fora do ar", ela precisa ser dita pelo nome e antes de todo
  // o resto: sem isso, se procura o defeito no lugar errado por horas.
  const cota = r.colecoes.find((c) => /RESOURCE_EXHAUSTED|quota/i.test(c.ultimoErro ?? ''));
  if (cota) {
    linhas.push('✗✗ COTA DIÁRIA DO FIRESTORE ESGOTADA.');
    linhas.push('   Nada é gravado nem lido até a virada do dia (meia-noite no Pacífico).');
    linhas.push('   Não é defeito de sincronia: o projeto inteiro para, todas as coleções.');
    linhas.push(`   ${cota.ultimoErro}`);
    linhas.push('');
  }

  const acervo = r.colecoes.find((c) => c.nome === 'catalogo');
  if (!acervo?.assinou) {
    linhas.push(`✗ Acervo do app: não chegou. ${acervo?.ultimoErro ?? '(sem erro registrado)'}`);
  } else {
    linhas.push(`✓ Acervo do app: ${acervo.docsNaNuvem} faixas`);
    if (acervo.docsNaNuvem === 0) {
      linhas.push('  Vazio. Se o admin já adicionou músicas, as regras do Firestore');
      linhas.push('  (coleção `catalogo`) provavelmente não foram publicadas.');
    }
    if (resumo.doAcervo > 0) linhas.push(`  ${resumo.doAcervo} já nesta biblioteca`);
  }

  // Chegar na tela e tocar são coisas diferentes. Uma faixa importada de
  // ARQUIVO guarda o áudio só no aparelho que a importou; nos outros ela depende
  // da cópia enviada ao importador. Sem essa cópia ela aparece para todo mundo e
  // não toca para ninguém — e o sintoma ("as músicas não chegaram") é o mesmo
  // de sincronia quebrada, por isso é dito aqui e não escondido.
  if (resumo.semFonteRemota > 0) {
    linhas.push('');
    linhas.push(`⚠ ${resumo.semFonteRemota} faixa(s) sem cópia no importador nem link de origem.`);
    linhas.push('  Elas aparecem na lista mas NÃO tocam fora do aparelho que as importou.');
    linhas.push('  O envio roda sozinho em segundo plano; se persistir, o importador');
    linhas.push('  estava fora do ar quando elas foram adicionadas.');
  }
  linhas.push('');

  const biblioteca = r.colecoes.find((c) => c.nome === 'library');
  if (!biblioteca || !biblioteca.uid) {
    linhas.push('✗ Ninguém logado neste aparelho.');
    linhas.push('  Sem conta, a biblioteca PESSOAL daqui fica só aqui.');
    linhas.push('  O acervo do app acima independe de login.');
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
