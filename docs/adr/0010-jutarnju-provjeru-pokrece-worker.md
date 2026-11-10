# Jutarnju provjeru pokreće Worker, a raspored u workflow-u je samo rezerva

`jutarnja-provjera.yml` je zakazan za 6:30 UTC, ali ga GitHub pokreće mnogo kasnije: 8.11. u 13:46 UTC, 9.11. u 16:46 UTC, a 10.11. u 15:10 UTC. Provjera koja stigne popodne ne javlja na vrijeme da jučerašnji izvještaj nije otišao. Isti problem je u ADR 0004 riješen za slanje.

Zato jutarnju provjeru pokreće Worker iz svog crona, preko `workflow_dispatch`, kao i pisanje i provjeru svježeg rada. GitHub token na Workeru već ima Actions: write, pa ne treba nova dozvola. `schedule` u workflow-u ostaje samo kao rezerva.

## Razmotrene opcije

- **Samo `schedule`**: ne košta ništa novo, ali kasni i po nekoliko sati, a pod opterećenjem GitHub može i da odbaci posao.
- **Samo Worker**: tačno, ali kad Worker ne radi, provjere nema. Jutarnja provjera je u Actions upravo da bi otkrila i kvar Workera.
- **Worker, uz `schedule` kao rezervu**: tačno kad Worker radi, a kvar Workera se i dalje otkrije, samo kasnije.

## Posljedice

- Worker pokreće provjeru jednom dnevno u 6:30 UTC, a u D1 pamti da ju je pokrenuo, kao kod samostalnog slanja. Cron koji izostane nadoknadi sljedeći.
- Rezervno pokretanje ne smije da pošalje istu poruku drugi put. Workflow zato prvo pogleda da li je provjera za taj dan već urađena, a ako jeste, završi bez poruke.
- Kad Worker ne radi, provjeru pokreće samo `schedule`, pa poruka o kvaru može da kasni i nekoliko sati. To se prihvata.
- Mijenja se rečenica iz worker/README.md da jutarnju provjeru „radi `jutarnja-provjera.yml`, a ne Worker". Provjeru i dalje radi workflow, a Worker je samo pokreće.
