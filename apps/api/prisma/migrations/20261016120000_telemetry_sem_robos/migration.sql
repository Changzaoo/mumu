-- LIMPA OS ROBÔS QUE A TELEMETRIA CONTOU COMO VISITANTES.
--
-- O Googlebot (e outros rastreadores) rodam o JavaScript de cada página com o
-- armazenamento zerado: cada página rastreada virava um aparelho novo, e o
-- painel juntou centenas de "Usuário · Outro · Chrome" com 1 sessão e 0 plays.
-- O filtro novo (app + API) impede novas linhas; esta migração tira as antigas.
--
-- O critério é CONSERVADOR de propósito — só some o que não tem como ser gente:
--   • nenhuma conta vinculada;
--   • plataforma "Outro" (o user-agent não diz sistema nenhum, o que navegador
--     de verdade sempre diz);
--   • nenhum segundo de uso medido e nenhum play.
DELETE FROM "TelemetryDevice"
WHERE "userId" IS NULL
  AND coalesce(data->>'email', '') = ''
  AND data->>'platform' = 'Outro'
  AND coalesce((data->>'totalSeconds')::numeric, 0) = 0
  AND coalesce((data->>'totalPlays')::numeric, 0) = 0;
