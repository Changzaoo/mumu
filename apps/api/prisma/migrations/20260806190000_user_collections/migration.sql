-- AS COLEÇÕES DE CADA USUÁRIO saem do Firestore: biblioteca, curtidas, playlists.
--
-- A leitura lá era cobrada por documento a cada abertura do app, e o limite
-- grátis é do projeto todo — quando estourava, caía tudo junto.
--
-- `deleted` é uma LÁPIDE. Sem ela a sincronia por delta não consegue contar que
-- algo sumiu: o outro aparelho pede "o que mudou desde X", recebe uma lista sem
-- o item apagado e conclui, errado, que nada aconteceu — a faixa removida no
-- computador reapareceria no celular para sempre.
CREATE TABLE "UserCollectionItem" (
    "userId" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCollectionItem_pkey" PRIMARY KEY ("userId","collection","itemId")
);

-- O cursor da sincronia por delta ("o que mudou desde X") sai deste índice.
CREATE INDEX "UserCollectionItem_userId_collection_updatedAt_idx"
    ON "UserCollectionItem"("userId", "collection", "updatedAt");

ALTER TABLE "UserCollectionItem"
    ADD CONSTRAINT "UserCollectionItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
