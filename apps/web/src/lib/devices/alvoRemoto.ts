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

import type { DeviceInfo } from '@/lib/devices/presence';

export interface AlvoRemoto {
  id: string;
  name: string;
}

let alvo: AlvoRemoto | null = null;

/**
 * QUEM RECEBE O CLIQUE — a regra do Spotify Connect, em uma função pura.
 *
 * O clique vai para outro aparelho da conta quando ele está online, tem uma
 * faixa e (a) está TOCANDO agora ou (b) é o DONO da posse — o último que tocou,
 * mesmo pausado. O caso (b) é o que faltava: a pessoa pausa no celular, vem ao
 * computador, clica num álbum e espera que ele CONTINUE no celular. Antes, o
 * álbum começava no computador, porque só o aparelho tocando contava.
 *
 * `surdos` é a lista de quem não respondeu a um pedido: um aparelho cujo app
 * morreu em segundo plano continua "online, tocando" na presença por um tempo.
 * Marcado como surdo, ele só volta a receber cliques quando publicar presença
 * de novo (`seenAt` mais novo que a marca) — sinal de que o app está vivo.
 */
export function escolherAlvoRemoto(
  devices: readonly DeviceInfo[],
  meuId: string,
  surdos: ReadonlyMap<string, number> = new Map(),
): AlvoRemoto | null {
  const responde = (d: DeviceInfo): boolean => {
    const marca = surdos.get(d.id);
    return marca === undefined || d.seenAt > marca;
  };
  const candidatos = devices.filter(
    (d) => d.id !== meuId && d.online && d.track !== null && responde(d),
  );
  const escolhido =
    candidatos.find((d) => d.isPlaying) ?? candidatos.find((d) => d.isActive) ?? null;
  return escolhido ? { id: escolhido.id, name: escolhido.name } : null;
}

/** Só a presença chama: o aparelho remoto que está tocando, ou `null`. */
export function definirAlvoRemoto(proximo: AlvoRemoto | null): void {
  alvo = proximo;
}

/** O aparelho remoto que está tocando agora, ou `null` quando é aqui mesmo. */
export function alvoRemotoAtual(): AlvoRemoto | null {
  return alvo;
}
