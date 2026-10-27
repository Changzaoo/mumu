/**
 * Artist-credit parsing — a regra vive em `@radinho/shared` (`creditosDeArtista`),
 * para que app, API e script de correção do banco separem "A, B", "A & B",
 * "A feat. B" e "MC A e MC B" do MESMO jeito. Este módulo só dá os nomes que o
 * app já usava e injeta a prova local que o " e " exige: os artistas que esta
 * biblioteca já conhece sozinhos (ver `conhecidoNaBiblioteca` em localLibrary).
 */
import {
  creditoAmbiguo,
  GRUPOS_COM_SEPARADOR_NO_NOME,
  separarCreditos,
  type OpcoesDeSeparacao,
} from '@radinho/shared';

/** Acts whose real name legitimately contains a separator — never split these. */
export const GROUP_EXCEPTIONS: ReadonlySet<string> = GRUPOS_COM_SEPARADOR_NO_NOME;

/**
 * Split an artist credit into distinct names. Always returns at least one name
 * for non-empty input. `conhecido` is the proof that lets " e " split (both
 * sides already exist as standalone artists).
 */
export function splitArtistNames(raw: string, opcoes: OpcoesDeSeparacao = {}): string[] {
  return separarCreditos(raw, opcoes);
}

/** True when a credit still has an AMBIGUOUS separator worth asking the AI about. */
export function creditIsAmbiguous(raw: string): boolean {
  return creditoAmbiguo(raw);
}
