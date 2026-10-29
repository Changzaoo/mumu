-- JORNADA: liga semanal e indicações de amigos.
--
-- Sequência de dias e conquistas moram no aparelho; aqui fica só o que precisa
-- ser comparado entre pessoas.
CREATE TABLE "Jornada" (
    "userId" TEXT NOT NULL,
    "semana" TEXT NOT NULL,
    "xpSemana" INTEGER NOT NULL DEFAULT 0,
    "liga" INTEGER NOT NULL DEFAULT 0,
    "sequencia" INTEGER NOT NULL DEFAULT 0,
    "recorde" INTEGER NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Jornada_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "Indicacao" (
    "deviceId" TEXT NOT NULL,
    "padrinhoId" TEXT NOT NULL,
    "indicadoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Indicacao_pkey" PRIMARY KEY ("deviceId")
);

-- O grupo da liga: mesma liga e mesma semana, do maior XP para o menor.
CREATE INDEX "Jornada_liga_semana_xpSemana_idx" ON "Jornada"("liga", "semana", "xpSemana");
CREATE INDEX "Indicacao_padrinhoId_idx" ON "Indicacao"("padrinhoId");
CREATE INDEX "Indicacao_indicadoId_idx" ON "Indicacao"("indicadoId");

ALTER TABLE "Jornada" ADD CONSTRAINT "Jornada_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Indicacao" ADD CONSTRAINT "Indicacao_padrinhoId_fkey" FOREIGN KEY ("padrinhoId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Indicacao" ADD CONSTRAINT "Indicacao_indicadoId_fkey" FOREIGN KEY ("indicadoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
