# Na pitanja o radu odgovara GitHub Actions preko Groka, a Worker drži red

Mentor i Nemanja mogu botu da postave pitanje o radu, svako sa svog chata. Bot je tu da mentoru kaže šta je Nemanja uradio, tako da mentor nikad ne mora da pita Nemanju. Poruke sa ostalih chatova se tiho preskaču.

Worker primi pitanje, odmah odgovori „Razmišljam, odgovor stiže za minut-dva." i pokrene workflow u privatnom repou. Workflow pročita podatke, pozove Groka, provjeri odgovor i vrati ga Workeru, koji ga pošalje na chat sa kog je pitanje stiglo. Odgovor stiže za 1–2 minuta.

Worker ne može sam da odgovara. Njegov GitHub token može samo da pokreće workflow-e (ADR 0004), pa ne vidi ni repoe ni bilješke. xAI ključ bi uz to morao i na Worker, a podaci bi prolazili kroz javno dostupan servis. Actions već ima privatni repo, ključ i provjeru iz ADR 0002.

## Šta bot zna

- Izvještaje, bilješke sesija i GitHub iz repoa sa spiska projekata, za posljednjih 30 dana. Gleda sve projekte iz `projekti.json`, aktivne i neaktivne, jer se pitanje može ticati rada od prije dvije sedmice. Bilješke sa projektom kog nema u `projekti.json` se i dalje preskaču.
- Sadržaj tehničke dokumentacije ne vidi, jer nije u repou. Iz izvještaja i bilješki ipak kaže šta je Nemanja na njoj uradio i izučavao.
- Kad nema podatak, kaže ono što zna, a za ostalo kratko kaže da o tome nema zapisa. Nikad ne izmišlja i nikad ne upućuje mentora na Nemanju.
- Na opšta pitanja kaže da odgovara o Nemanjinom radu. Na pitanja o samom botu kaže da je tu da priča o tome šta je Nemanja uradio i vrati se na temu. Nikad ne tvrdi ništa netačno.

## Oblik odgovora

- Odgovor ima do 6–8 rečenica i na jeziku je pitanja. O Nemanji piše u trećem licu. Mentoru se obraća na „ti", osim ako mentor zatraži persiranje, a to se pamti.
- Grok vraća strogu šemu, isto kao za izvještaj (ADR 0006): `tekst`, `izvjestaji` (datumi izvještaja iz kojih odgovor dolazi) i `persiranje` (`da`, `ne` ili `bez_promjene`). Link na izvještaj na sajtu dodaje Python, pa Grok ne može da izmisli link.
- Filter iz ADR 0002 i spisak zabranjenih pojmova provjeravaju bilješke, podatke sa GitHub-a i gotov odgovor. Bilješka sa pogotkom ne ide Groku, a odgovor sa pogotkom se ne šalje.
- Pitanje se provjerava samo obrascima tajni i putanja. Pitanje sa takvim pogotkom se odbija prije Groka i ne čuva se, a chat dobija poruku da pitanje liči na lozinku, ključ ili putanju. Zabranjeni pojmovi u pitanju se puštaju, jer ih je napisao onaj ko pita. Odgovor se i tada provjerava cijelim filterom, pa zabranjen pojam iz pitanja ne može da stigne u odgovor.

## Red, pamćenje i rokovi

- Svaki chat ima svoj red u D1. Sljedeće pitanje kreće tek kad stigne odgovor na prethodno, pa dodatno pitanje vidi odgovor na koji se nastavlja. Poruke koje se nakupe u redu idu zajedno, kao jedno pitanje.
- Bot pamti 5 posljednjih pitanja i odgovora sa istog chata, iz posljednja 24 sata. Razgovori su odvojeni po chatu, pa mentor nikad ne vidi Nemanjina pitanja ni odgovore Nemanji.
- Worker čeka odgovor 5 minuta od pokretanja workflow-a. Grok ima rok od 150 sekundi, a ponovni pokušaj ide samo ako stane u tih 5 minuta. Odgovor koji stigne poslije roka se odbacuje.
- Ako odgovor ne stigne u roku ili ne prođe filter, mentor dobija „Trenutno ne mogu da odgovorim, pokušaj ponovo za nekoliko minuta.", a Nemanja poruku o grešci. Red prelazi na sljedeće pitanje.
- Mentor može da postavi najviše 15 pitanja po kalendarskom danu. Neuspjelo pitanje i poruka bez teksta se ne broje. Nemanjina pitanja nemaju limit.

## Čuvanje

Pitanja i odgovori se čuvaju u privatnom repou radi provjere, u folderu `pitanja-o-radu/`, jedan fajl po pitanju. Chat se u fajlu označava sa `mentor` ili `nemanja`, a ne ID-em. Persiranje je u `pitanja-o-radu/podesavanja.json`, a upisuje ga Python na osnovu Grokovog polja. Tekst razgovora je u D1 samo dok čeka u redu.

## Razmotrene opcije

- **Worker sam zove Groka**: brži odgovor, ali Worker ne vidi repoe, xAI ključ bi bio na dva mjesta, a provjera iz ADR 0002 postoji samo u Python kodu.
- **Pitanja paralelno**: brže, ali dodatno pitanje ne bi vidjelo odgovor na koji se nastavlja.
- **Pamćenje i persiranje u D1**: Worker bi držao tekst razgovora i slao ga workflow-u. To je više tajnog teksta na javno dostupnom servisu, a ništa se ne dobija.
- **Slobodan tekst bez šeme**: Grok bi mogao da izmisli link na izvještaj.

## Posljedice

- Uključivanje za mentora je podešavanje `PITANJA_MENTORA` u `wrangler.toml`, isto kao `PROBNI_REZIM`. Dok nije `ukljucena`, rade samo Nemanjina pitanja, a mentorove poruke se tiho preskaču. Na prvi cron poslije uključivanja mentor jednom dobija kratku uvodnu poruku, a Worker u D1 upiše da je poslata.
- Sa Nemanjinog chata komande su samo poruke „završio" i „odloži", sa kvačicom ili bez nje. Sve ostalo je pitanje o radu. Mentorova poruka je uvijek pitanje.
- Pitanje o radu nikad ne mijenja stanje radnog dana i radi i na zatvoren dan i dok pisanje teče.
- Commitovi u `pitanja-o-radu/` nisu rad: ne ulaze u izvještaj i ne računaju se kao aktivnost za samostalno slanje (ADR 0008). Objava i `testovi.yml` ignorišu taj folder.
- Pitanje o radu i pisanje izvještaja mogu da commit-uju u isto vrijeme, pa oba workflow-a prije ponovnog push-a rade `git pull --rebase`.
- Svako pitanje troši otprilike minut Actions. Limit od 15 pitanja čuva besplatne minute privatnog repoa.
