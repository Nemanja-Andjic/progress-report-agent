-- Vrijeme kad je poruka stigla, da cron ne pokrene poruku dok Worker još čeka druge sa istog chata.
-- Poruka bez vremena važi kao stara.
ALTER TABLE pitanja_o_radu ADD COLUMN stiglo INTEGER;
