-- Odloženo slanje: poslije "odloži" izvještaj ide na "završio" ili u 1:00 (ADR 0008).
ALTER TABLE dani ADD COLUMN odlozeno_slanje INTEGER NOT NULL DEFAULT 0;
