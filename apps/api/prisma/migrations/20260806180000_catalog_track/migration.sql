-- O ACERVO sai do Firestore e passa a morar aqui.
--
-- Motivo em uma linha: a coleção inteira era lida a cada abertura do app, por
-- cada pessoa, e o limite grátis de 50 mil leituras/dia é do projeto todo — ele
-- estourou três vezes, derrubando sincronia e curtidas junto.
--
-- `data` guarda o LibraryEntry inteiro: o formato é do cliente e muda com ele,
-- e nenhuma consulta precisa filtrar por dentro (são centenas de linhas, lidas
-- de uma vez e servidas com ETag).
CREATE TABLE "CatalogTrack" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogTrack_pkey" PRIMARY KEY ("id")
);

-- O ETag da listagem sai de max(updatedAt) + count: este índice torna isso O(1).
CREATE INDEX "CatalogTrack_updatedAt_idx" ON "CatalogTrack"("updatedAt");
