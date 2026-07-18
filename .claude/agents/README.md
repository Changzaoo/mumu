# Time de agentes do Aurial

Cinco frentes, uma dona cada. As fronteiras existem para que dois agentes não
"consertem" o mesmo sintoma em camadas diferentes e criem correção dupla.

| Agente             | Frente                                   | Sintoma típico                            |
| ------------------ | ---------------------------------------- | ----------------------------------------- |
| `player-guardian`  | a música sair do alto-falante            | trava, spinner eterno, 0:00, fila para    |
| `catalog-scout`    | existir faixa tocável para pedir         | "indisponível" em massa, busca vazia      |
| `downloads-keeper` | o áudio estar no aparelho e continuar lá | não baixa, baixa e some, não toca offline |
| `lyrics-curator`   | a letra certa na hora certa              | letra de outra música, fora de sincronia  |
| `taste-agent`      | a próxima música fazer sentido           | "Feito para você" some, ignora likes      |

## Como o sintoma mapeia para o dono

O mesmo sintoma pode nascer em frentes diferentes — o que decide é a **causa**:

- _"Faixa não toca"_ → sem fonte resolvível = `catalog-scout`; fonte existe mas
  o engine não sai do lugar = `player-guardian`; deveria estar baixada e não
  está = `downloads-keeper`.
- _"0:00 na duração"_ → metadata da fonte veio zerada/NaN = `catalog-scout`;
  o elemento revelou a duração e o store ignorou = `player-guardian`.
- _"Prateleira vazia"_ → sem sinal de gosto ou limiar mal calibrado =
  `taste-agent`; catálogo não devolveu nada = `catalog-scout`.

Quando a causa cai fora do seu território: **relate, não corrija.** Correção
fora de casa é como um bug volta pela porta dos fundos.

## Princípios que valem para todos

1. **Falha silenciosa é o bug.** `catch {}` que engole erro transforma uma
   falha alta e diagnosticável numa falha muda e permanente. Todo `catch`
   precisa de recuperação ou de sinal — nunca de silêncio.
2. **Todo caminho que liga um estado de espera precisa de um caminho garantido
   que o desliga.** Vale para `isBuffering`, `inFlight`, "agente organizando…".
3. **Toda operação de rede tem timeout.** Sem isso a espera é infinita.
4. **Fonte de terceiros omite campo sem avisar.** Todo número que vem de fora
   precisa de guarda antes de virar `NaN` na tela.
5. **Comentário explica o porquê**, em pt-BR, como o resto do código.
6. **Rode os testes** (`pnpm --filter @aurial/web test`) e o typecheck
   (`pnpm typecheck`) antes de dar qualquer coisa por pronta.
