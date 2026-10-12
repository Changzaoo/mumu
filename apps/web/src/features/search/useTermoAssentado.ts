import { useEffect, useState } from 'react';

/** Espera o dedo parar: cada tecla na barra de cima troca o `q` da URL. */
const PAUSA_DE_DIGITACAO_MS = 700;

/** O termo só depois que a pessoa parou de digitar — cada busca custa uma ida ao YouTube. */
export function useTermoAssentado(termo: string): string {
  const [assentado, setAssentado] = useState(termo);
  useEffect(() => {
    const t = setTimeout(() => setAssentado(termo), PAUSA_DE_DIGITACAO_MS);
    return () => clearTimeout(t);
  }, [termo]);
  return assentado;
}
