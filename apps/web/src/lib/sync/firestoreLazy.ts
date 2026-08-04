/**
 * O módulo `firebase/firestore`, carregado sob demanda.
 *
 * Existe porque um único `import { doc, setDoc } from 'firebase/firestore'` num
 * arquivo alcançável a partir da primeira tela basta para arrastar os ~250 kB do
 * Firestore de volta para o chunk de entrada — e aí não adianta o SDK do
 * Firebase ser carregado tarde (ver `lib/firebase.ts`): o bundler já colocou
 * tudo na frente do primeiro pixel.
 *
 * A regra do repositório passa a ser: NENHUM import estático de
 * `firebase/firestore` fora de páginas (que já são chunks separados). Quem
 * precisa das funções pede aqui. Imports de TIPO continuam livres — o
 * TypeScript os apaga e eles não pesam nada no bundle.
 */
import type * as FirestoreApi from 'firebase/firestore';

export type FirestoreModule = typeof FirestoreApi;

let mod: Promise<FirestoreModule> | null = null;

export function firestore(): Promise<FirestoreModule> {
  return (mod ??= import('firebase/firestore'));
}
