-- O LOTE APRENDIDO PELA CURADORIA PRECISA SOBREVIVER AO CONTÊINER.
--
-- O lote se ajusta sozinho à cota da NVIDIA: cai pela metade quando toma 429,
-- sobe um quarto quando a volta passa limpa. A regra funciona — o que não
-- funcionava era a memória. Ela era uma variável de módulo, então morria a cada
-- deploy e a cada reinício.
--
-- Medido em produção: o worker recriado às 10:55Z voltou ao teto de 150 e
-- queimou 222 recusas para reaprender exatamente a descida que já tinha feito
-- (150 → 75 → 37). Não é um custo de uma vez: é o preço de cada deploy.
--
-- Genérica de propósito: o próximo worker que precisar lembrar de alguma coisa
-- não deve precisar de outra migração.
CREATE TABLE "WorkerState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerState_pkey" PRIMARY KEY ("key")
);
