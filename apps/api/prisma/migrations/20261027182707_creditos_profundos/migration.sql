-- CreateEnum
CREATE TYPE "PapelDeCredito" AS ENUM ('PRODUTOR', 'COMPOSITOR', 'LETRISTA', 'ARRANJADOR', 'MIXAGEM', 'MASTERIZACAO', 'ENGENHEIRO', 'INTERPRETE', 'GRAVADORA', 'SELO', 'PRODUTORA', 'EDITORA', 'EMPRESARIO');

-- AlterTable
ALTER TABLE "FichaDoArtista" ADD COLUMN     "creditosEm" TIMESTAMP(3),
ADD COLUMN     "creditosErro" TEXT,
ADD COLUMN     "creditosProximaEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FichaDaFaixa" (
    "trackId" TEXT NOT NULL,
    "mbRecordingId" TEXT,
    "mbWorkId" TEXT,
    "mbReleaseId" TEXT,
    "discogsReleaseId" INTEGER,
    "lidoEm" TIMESTAMP(3),
    "proximaEm" TIMESTAMP(3),
    "erro" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 0,
    "chamadas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FichaDaFaixa_pkey" PRIMARY KEY ("trackId")
);

-- CreateTable
CREATE TABLE "CreditoDaFaixa" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "papel" "PapelDeCredito" NOT NULL,
    "nome" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditoDaFaixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditoDoArtista" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "papel" "PapelDeCredito" NOT NULL,
    "nome" TEXT NOT NULL,
    "chaveDoNome" TEXT NOT NULL,
    "fonte" TEXT NOT NULL,
    "dados" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditoDoArtista_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FichaDaFaixa_proximaEm_idx" ON "FichaDaFaixa"("proximaEm");

-- CreateIndex
CREATE INDEX "CreditoDaFaixa_trackId_idx" ON "CreditoDaFaixa"("trackId");

-- CreateIndex
CREATE INDEX "CreditoDaFaixa_chave_papel_idx" ON "CreditoDaFaixa"("chave", "papel");

-- CreateIndex
CREATE INDEX "CreditoDoArtista_chave_idx" ON "CreditoDoArtista"("chave");

-- CreateIndex
CREATE INDEX "CreditoDoArtista_chaveDoNome_papel_idx" ON "CreditoDoArtista"("chaveDoNome", "papel");

-- AddForeignKey
ALTER TABLE "CreditoDaFaixa" ADD CONSTRAINT "CreditoDaFaixa_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "FichaDaFaixa"("trackId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditoDoArtista" ADD CONSTRAINT "CreditoDoArtista_chave_fkey" FOREIGN KEY ("chave") REFERENCES "FichaDoArtista"("chave") ON DELETE CASCADE ON UPDATE CASCADE;
