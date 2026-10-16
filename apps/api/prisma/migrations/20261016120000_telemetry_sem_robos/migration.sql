-- LIMPA OS ROBÔS QUE A TELEMETRIA CONTOU COMO VISITANTES.
--
-- O Googlebot (e outros rastreadores) rodam o JavaScript de cada página com o
-- armazenamento zerado: cada página rastreada virava um aparelho novo, e o
-- painel juntou centenas de "Usuário · Outro · Chrome" com 1 sessão e 0 plays.
-- O filtro novo (app + API) impede novas linhas; esta migração tira as antigas.
--
-- O critério é CONSERVADOR de propósito — só some o que não tem como ser gente:
--   • nenhuma conta vinculada;
--   • nenhum segundo de uso medido e nenhum play;
--   • E uma marca de robô: plataforma "Outro" (o user-agent não diz sistema
--     nenhum, o que navegador de verdade sempre diz) OU GPU SwiftShader (a
--     renderização por software do Chrome sem cabeça).
--
-- Medido na produção antes desta migração (2026-10-16): 6.348 linhas, 14 com
-- conta; 6.186 anônimas "Outro", 6.177 delas com SwiftShader. Nenhuma das 14
-- contas tem SwiftShader.
DELETE FROM "TelemetryDevice"
WHERE "userId" IS NULL
  AND coalesce(data->>'email', '') = ''
  AND coalesce((data->>'totalSeconds')::numeric, 0) = 0
  AND coalesce((data->>'totalPlays')::numeric, 0) = 0
  AND (data->>'platform' = 'Outro' OR data->>'gpu' ILIKE '%swiftshader%');
