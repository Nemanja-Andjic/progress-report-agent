# Pitanja i dugmad su na Cloudflare Workeru, a izvještaj piše GitHub Actions

Agent mora tokom dana da pita Nemanju da li je završio, da odmah primi odgovor sa dugmeta i da u 23:00 pošalje izvještaj. Sve to radi mali Cloudflare Worker, koji za pisanje i objavu pokreće GitHub Actions. Pisanje izvještaja i poziv Groka ostaju u Python kodu u Actions.

Sve u Actions bi bilo jednostavnije, ali GitHub cron nije dovoljno tačan: `provjera-zastite.yml`, zakazan za 7:00 UTC, kretao je između 07:40 i 08:15, a GitHub piše da pod opterećenjem može i da odbaci posao. Slanje u 23:00 bi tako moglo preći ponoć, odgovor na dugme bi čekao sljedeću provjeru, a provjera na 15 minuta bi potrošila veliki dio besplatnih minuta.

## Posljedice

- Worker mora biti javno dostupan, jer ga Telegram poziva. Zato nije iza Cloudflare Access-a i sam provjerava svaki zahtjev.
- Dok je webhook uključen, `getUpdates` ne radi za tog bota.
- Cron okidači Workera rade po UTC-u, pa Worker sam računa lokalno vrijeme, da prelazak na ljetnje ili zimsko vrijeme ne pomjeri 23:00.
- Worker je na posebnom besplatnom Cloudflare nalogu, a ne na nalogu sa sajtom. Token za objavu sajta može da izmijeni svaki Worker na svom nalogu (ADR 0003), a ovaj Worker drži Telegram token i GitHub token.
- GitHub token na Workeru je fine-grained, samo za privatni repo i samo za pokretanje workflow-a (Actions: write), ništa više.
- Telegram token je na Workeru. Mentoru poruke šalje samo Worker. Nemanji ih Worker šalje i na zahtjev Actions-a, preko opšte rute za poruke vlasniku, koja tekst samo proslijedi na Nemanjin chat. Kroz nju idu greške i obavještenja.
- Jedini izuzetak je jutarnja provjera ([0010](0010-jutarnju-provjeru-pokrece-worker.md)), kad Worker ne odgovara. Tada ruta ne radi, pa workflow padne, a GitHub pošalje mejl, i workflow sam pošalje Nemanji direktnu poruku. Zato je Telegram token i u GitHub Secrets privatnog repoa, samo za taj korak. Sve ostale poruke Nemanji iz Actions-a idu preko opšte rute.
- Slanje „u 23:00" je zamijenjeno samostalnim slanjem poslije 23:00 iz [0008](0008-radni-dan-i-samostalno-slanje-poslije-23.md).
