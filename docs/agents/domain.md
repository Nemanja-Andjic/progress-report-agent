# Domenska dokumentacija

Kako engineering skillovi treba da koriste domensku dokumentaciju ovog repoa dok istražuju kod.

## Prije istraživanja pročitaj

- **`GLOSSARY.md`** u korijenu repoa.
- **`docs/adr/`**: ADR-ove koji se tiču dijela koda na kom ćeš raditi.

Ako neki od ovih fajlova ne postoji, **nastavi bez komentara**. Ne prijavljuj da nedostaje i ne predlaži da se unaprijed napravi. Skill `/domain-modeling` (do njega se stiže preko `/grill-with-docs` i `/improve-codebase-architecture`) pravi ih tek kad se neki pojam ili odluka zaista razriješi.

## Struktura fajlova

Ovaj repo je single-context:

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-primjer-odluke.md
│   └── 0002-druga-odluka.md
└── src/
```

## Koristi rječnik iz glosara

Kad tvoj rezultat imenuje domenski pojam (u naslovu issue-a, prijedlogu refaktora, hipotezi, imenu testa), koristi termin onako kako je definisan u `GLOSSARY.md`. Ne prelazi na sinonime koje glosar izričito izbjegava.

Ako pojma koji ti treba još nema u glosaru, to je signal: ili izmišljaš jezik koji projekat ne koristi (razmisli ponovo), ili postoji stvarna rupa (zabilježi je za `/domain-modeling`).

## Prijavi sukob s ADR-om

Ako se tvoj rezultat kosi s postojećim ADR-om, reci to izričito umjesto da ga prećutno zaobiđeš:

> _Kosi se s ADR-0007 (event-sourced narudžbe), ali vrijedi ga ponovo otvoriti jer…_
