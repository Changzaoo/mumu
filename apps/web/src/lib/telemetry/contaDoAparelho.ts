/**
 * QUEM É A MESMA PESSOA no painel de telemetria.
 *
 * A telemetria é gravada por aparelho. O servidor vincula o aparelho à conta
 * (`userId`) na primeira sessão logada e NUNCA desfaz o vínculo — é a única
 * identidade que sobrevive a uma sessão deslogada. Já o e-mail dentro do
 * documento vem do cliente a cada envio, e um iPhone com o app instalado que
 * abriu sem login mandava `email: null`: a linha caía fora do grupo da conta e
 * aparecia como "Usuário", com 4.828 músicas, como se fosse outra pessoa.
 *
 * Por isso a chave do grupo é o `userId` quando existe; o e-mail só entra para
 * documento antigo sem vínculo. E a identidade do grupo (e-mail, nome) vem de
 * QUALQUER aparelho que a tenha, não só do visto por último.
 */
export interface DocDeConta {
  /** `userId` do servidor quando vinculado; `anon:<deviceId>` quando não. */
  uid: string;
  email?: string | null;
  displayName?: string | null;
}

export const PREFIXO_ANONIMO = 'anon:';

/** Chave que junta os aparelhos de uma mesma pessoa. */
export function chaveDaConta(t: DocDeConta): string {
  if (!t.uid.startsWith(PREFIXO_ANONIMO)) return `u:${t.uid}`;
  if (t.email) return `e:${t.email.toLowerCase()}`;
  return `u:${t.uid}`;
}

/**
 * E-mail e nome do grupo: o do representante quando ele os tem; senão, os do
 * primeiro aparelho do grupo que os gravou.
 */
export function identidadeDoGrupo(
  grupo: ReadonlyArray<DocDeConta>,
  base: DocDeConta,
): { email: string | null; displayName: string | null } {
  return {
    email: base.email ?? grupo.find((t) => t.email)?.email ?? null,
    displayName: base.displayName ?? grupo.find((t) => t.displayName)?.displayName ?? null,
  };
}
