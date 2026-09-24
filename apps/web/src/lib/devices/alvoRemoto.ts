/**
 * ONDE O SOM ESTÁ SAINDO — um recado de uma linha, lido sem esperar nada.
 *
 * O player precisa saber, NA HORA em que o usuário clica numa música, se quem
 * está tocando é este aparelho ou outro. "Na hora" é o ponto: a decisão é
 * síncrona (tocar aqui ou mandar para lá), e a presença vive num módulo que
 * importa o próprio player — puxá-lo de dentro do store fecharia um ciclo de
 * imports, e um `import()` dinâmico só responderia depois, quando a música já
 * tivesse começado no lugar errado.
 *
 * Então a presença DEPOSITA aqui o aparelho da vez, e o player LÊ. Os dois
 * conhecem este arquivo; nenhum conhece o outro.
 */

export interface AlvoRemoto {
  id: string;
  name: string;
}

let alvo: AlvoRemoto | null = null;

/** Só a presença chama: o aparelho remoto que está tocando, ou `null`. */
export function definirAlvoRemoto(proximo: AlvoRemoto | null): void {
  alvo = proximo;
}

/** O aparelho remoto que está tocando agora, ou `null` quando é aqui mesmo. */
export function alvoRemotoAtual(): AlvoRemoto | null {
  return alvo;
}
