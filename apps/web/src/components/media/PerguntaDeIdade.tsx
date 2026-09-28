/**
 * "QUANDO VOCÊ NASCEU?" — perguntado uma vez, para o app saber o que a pessoa
 * pode ouvir (ver lib/conteudo/faixaEtaria.ts).
 *
 * Mês e ano bastam (a idade não precisa do dia, e é menos dado pessoal).
 * Fechar sem responder não libera nada: enquanto a idade é desconhecida vale a
 * regra do adolescente (nada explícito), e a pergunta volta na próxima abertura.
 * A resposta vai para a conta e vale em todos os aparelhos.
 *
 * `ajuste`: na tela de Ajustes, para corrigir. Quem está numa faixa com
 * restrição não pode, sozinho, mudar para uma idade MAIOR — senão a proteção
 * seria um clique.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { julgarLetrasGuardadas, podeTrocarPara } from '@/lib/conteudo/faixaEtaria';
import { useSettingsStore } from '@/stores/settingsStore';

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

export function PerguntaDeIdade({
  aberta: abertaForcada,
  aoFechar,
}: {
  /** Controlado (Ajustes). Sem isto, abre sozinha quando a idade é desconhecida. */
  aberta?: boolean;
  aoFechar?: () => void;
} = {}) {
  const dataNascimento = useSettingsStore((s) => s.dataNascimento);
  const definir = useSettingsStore((s) => s.setDataNascimento);
  const [dispensada, setDispensada] = useState(false);
  const aberta = abertaForcada ?? (!dataNascimento && !dispensada);

  const anoAtual = new Date().getFullYear();
  const anos = useMemo(() => Array.from({ length: 100 }, (_, i) => anoAtual - i), [anoAtual]);
  const [mes, setMes] = useState('');
  const [ano, setAno] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberta) setErro('');
  }, [aberta]);

  const fechar = (): void => {
    setDispensada(true);
    aoFechar?.();
  };

  const salvar = (): void => {
    if (!mes || !ano) {
      setErro('Escolha o mês e o ano.');
      return;
    }
    const valor = `${ano}-${mes.padStart(2, '0')}`;
    if (!podeTrocarPara(dataNascimento, valor)) {
      setErro('Para mudar para uma idade maior, peça a um responsável pela conta.');
      return;
    }
    definir(valor);
    void julgarLetrasGuardadas();
    fechar();
  };

  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quando você nasceu?</DialogTitle>
          <DialogDescription>
            Usamos só para mostrar músicas adequadas à sua idade. Menores de 18 não ouvem músicas
            com palavrão ou conteúdo explícito.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <select
            aria-label="Mês de nascimento"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="h-10 flex-1 rounded-md border border-border bg-bg-elevated px-2 text-sm text-fg"
          >
            <option value="">Mês</option>
            {MESES.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </select>
          <select
            aria-label="Ano de nascimento"
            value={ano}
            onChange={(e) => setAno(e.target.value)}
            className="h-10 flex-1 rounded-md border border-border bg-bg-elevated px-2 text-sm text-fg"
          >
            <option value="">Ano</option>
            {anos.map((a) => (
              <option key={a} value={String(a)}>
                {a}
              </option>
            ))}
          </select>
        </div>
        {erro && <p className="text-sm text-danger">{erro}</p>}
        <Button variant="accent" onClick={salvar}>
          Confirmar
        </Button>
      </DialogContent>
    </Dialog>
  );
}
