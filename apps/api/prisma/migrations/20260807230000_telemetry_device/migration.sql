-- A TELEMETRIA PASSA A CONTAR QUEM NÃO FEZ LOGIN.
--
-- Ela vivia em `telemetry/{uid}` no Firestore, e isso deixava dois buracos ao
-- mesmo tempo.
--
-- O primeiro é o que o dono notou: quem não fez login NÃO EXISTIA. O painel
-- mostrava só contas registradas, então todo visitante — justamente quem mais
-- interessa entender, porque ainda não decidiu ficar — era invisível. Não era
-- um defeito de gravação; era a chave do documento sendo o uid.
--
-- O segundo é de custo: era mais uma coleção no Firestore, cuja cota gratuita
-- (50 mil leituras/dia, do projeto inteiro) já derrubou acervo, sincronia e
-- curtidas três vezes. Mandar TODO visitante escrever lá seria acelerar o
-- próximo apagão em vez de evitá-lo.
--
-- A chave aqui é o APARELHO, porque é o que existe sempre. `userId` entra
-- quando a pessoa faz login, e é ele que liga as sessões anônimas de antes à
-- conta criada depois — sem isso não dá para enxergar que o visitante de ontem
-- virou usuário hoje, que é a única pergunta que essa tela precisa responder.
CREATE TABLE "TelemetryDevice" (
    "deviceId" TEXT NOT NULL,
    "userId" TEXT,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryDevice_pkey" PRIMARY KEY ("deviceId")
);

CREATE INDEX "TelemetryDevice_userId_idx" ON "TelemetryDevice"("userId");

-- O painel lista por atividade recente.
CREATE INDEX "TelemetryDevice_updatedAt_idx" ON "TelemetryDevice"("updatedAt");

-- SEM CHAVE ESTRANGEIRA PARA "User", de propósito. O aparelho aparece ANTES de
-- existir conta — é esse o caso todo —, e uma FK obrigaria a inventar usuário
-- para visitante ou a recusar a escrita. Quando a conta some, a linha vira
-- histórico anônimo, que é o comportamento correto para telemetria.
