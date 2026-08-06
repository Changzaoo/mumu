/**
 * Stub de `virtual:pwa-register` para os testes.
 *
 * O módulo real é gerado pelo plugin do PWA, que não roda no vitest. Sem algo
 * aqui, `src/pwa.ts` sequer é transformado e o atualizador fica sem teste — e
 * foi justamente ele que deixou um celular preso num build antigo enquanto a
 * correção já estava publicada.
 *
 * Quem testa o atualizador substitui isto por `vi.mock`; este arquivo só precisa
 * existir e ter a forma certa.
 */
export function registerSW(_opts: unknown): (recarregar?: boolean) => Promise<void> {
  return async () => undefined;
}
