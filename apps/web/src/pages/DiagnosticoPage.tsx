/**
 * Por que uma faixa não toca NESTE aparelho.
 *
 * Existe porque a primeira versão do diagnóstico só rodava pelo console do
 * navegador — e o problema que ele precisava explicar acontecia justamente no
 * celular, onde não existe F12. Um diagnóstico que só funciona no aparelho que
 * está bom não diagnostica nada.
 *
 * A cadeia importa porque "indisponível" é o mesmo texto para quatro falhas
 * diferentes. Em especial: uma faixa importada no computador guarda o áudio
 * SÓ ali. Para tocar em qualquer outro aparelho ela depende da cópia enviada ao
 * importador — e se esse envio falhou, o computador continua tocando normalmente
 * enquanto o celular não toca nada, sem nenhuma pista na tela.
 */
import { useCallback, useEffect, useState } from 'react';
import { relatorioDeReproducao } from '@/lib/local/playbackDiagnosis';
import { list as listarBiblioteca } from '@/lib/local/localLibrary';
import { relatorioSyncTexto } from '@/lib/sync/syncStatus';

export default function DiagnosticoPage(): React.ReactElement {
  const [relatorio, setRelatorio] = useState<string>('Verificando…');
  const [rodando, setRodando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const rodar = useCallback(async () => {
    setRodando(true);
    setCopiado(false);
    try {
      // A SINCRONIA VEM PRIMEIRO. "Este aparelho está desatualizado" e "esta
      // faixa não toca" chegam como a mesma reclamação, e a resposta certa
      // costuma ser a de cima: conta diferente, snapshot que nunca chegou, cota
      // do navegador estourada. Sem isto aqui, a pessoa lia o diagnóstico de
      // reprodução inteiro para descobrir que o problema era outro.
      const entradas = listarBiblioteca();
      const { auth } = await import('@/lib/firebase');
      const usuario = auth?.currentUser ?? null;
      const sincronia = relatorioSyncTexto(
        {
          total: entradas.length,
          doAcervo: entradas.filter((e) => e.origem === 'catalogo').length,
          // Sem cópia no importador E sem link de origem = só toca no aparelho
          // que importou. Ver ResumoBiblioteca.
          semFonteRemota: entradas.filter((e) => !e.remoteUrl && !e.sourceUrl).length,
        },
        {
          uid: usuario?.uid ?? null,
          email: usuario?.email ?? null,
          anonima: usuario?.isAnonymous ?? false,
        },
      );
      setRelatorio(`${sincronia}\n\n${'─'.repeat(48)}\n\n${await relatorioDeReproducao()}`);
    } catch (err) {
      setRelatorio(`O diagnóstico falhou: ${(err as Error).message}`);
    } finally {
      setRodando(false);
    }
  }, []);

  useEffect(() => {
    void rodar();
  }, [rodar]);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(relatorio);
      setCopiado(true);
    } catch {
      // Sem permissão de área de transferência (comum em http://): o texto
      // continua selecionável na tela, que é o que importa.
      setCopiado(false);
    }
  }, [relatorio]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Diagnóstico</h1>
        <p className="text-sm opacity-70">
          Mostra, passo a passo, por que este aparelho está desatualizado e por que uma faixa não
          toca. Rode no aparelho com problema — o resultado é diferente em cada um.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void rodar()}
          disabled={rodando}
          className="rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
        >
          {rodando ? 'Verificando…' : 'Verificar de novo'}
        </button>
        <button
          type="button"
          onClick={() => void copiar()}
          className="rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
        >
          {copiado ? 'Copiado!' : 'Copiar relatório'}
        </button>
      </div>

      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-black/40 p-4 font-mono text-xs leading-relaxed">
        {relatorio}
      </pre>

      <p className="text-xs opacity-60">
        Uma faixa importada guarda o áudio só no aparelho onde foi importada. Nos outros ela depende
        da cópia enviada ao importador; se esse envio falhou, ela toca lá e não toca aqui.
      </p>
    </div>
  );
}
