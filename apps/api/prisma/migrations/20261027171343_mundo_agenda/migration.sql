-- CreateEnum
CREATE TYPE "TipoDeEvento" AS ENUM ('SHOW', 'FESTIVAL', 'TRANSMISSAO', 'PREMIO', 'LANCAMENTO');

-- CreateTable
CREATE TABLE "FichaDoArtista" (
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mbid" TEXT,
    "wikidataId" TEXT,
    "youtubeCanal" TEXT,
    "links" JSONB,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "agendaEm" TIMESTAMP(3),
    "agendaErro" TEXT,
    "chamadas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FichaDoArtista_pkey" PRIMARY KEY ("chave")
);

-- CreateTable
CREATE TABLE "EventoDoArtista" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" "TipoDeEvento" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "quando" TIMESTAMP(3),
    "local" TEXT,
    "cidade" TEXT,
    "pais" TEXT,
    "preco" TEXT,
    "linkIngresso" TEXT,
    "link" TEXT,
    "youtubeId" TEXT,
    "embed" BOOLEAN NOT NULL DEFAULT false,
    "fonte" TEXT NOT NULL,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventoDoArtista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FichaDoArtista_agendaEm_idx" ON "FichaDoArtista"("agendaEm");

-- CreateIndex
CREATE INDEX "FichaDoArtista_prioridade_idx" ON "FichaDoArtista"("prioridade");

-- CreateIndex
CREATE INDEX "EventoDoArtista_chave_quando_idx" ON "EventoDoArtista"("chave", "quando");

-- CreateIndex
CREATE INDEX "EventoDoArtista_tipo_quando_idx" ON "EventoDoArtista"("tipo", "quando");

-- AddForeignKey
ALTER TABLE "EventoDoArtista" ADD CONSTRAINT "EventoDoArtista_chave_fkey" FOREIGN KEY ("chave") REFERENCES "FichaDoArtista"("chave") ON DELETE CASCADE ON UPDATE CASCADE;
