# Progress Report Agent

Agent koji na kraju dana sam napiše izvještaj o Nemanjinom radu i pošalje ga mentoru.

## Jezik

**Mentor**:
Tarik, osoba kojoj su izvještaji namijenjeni.

**Agent**:
Program koji sam sastavlja i objavljuje izvještaje, bez Nemanjine ruke.
_Izbjegavaj_: bot (bot je samo Telegram nalog preko kog agent šalje poruke i odgovara na pitanja o radu)

**Izvještaj**:
Pregled rada za jedan radni dan. Nosi datum radnog dana i sastoji se od spiska stavki.
_Izbjegavaj_: dnevnik, report

**Ručno ispravljen izvještaj**:
Izvještaj koji je napisao agent, a poslije ga je mijenjao čovjek. Nosi i oznaku agenta i oznaku "ručno ispravljeno", a agent ga više nikad ne pregazi.

**Ručno napisan izvještaj**:
Izvještaj koji je čovjek napisao od nule, bez agenta. Nosi samo oznaku "napisano ručno", bez oznake agenta, a agent ga nikad ne pregazi.

**Period izvještaja**:
Vrijeme koje izvještaj pokriva: od prethodnog izvještaja do trenutka pisanja, a ne kalendarski dan.

**Dan bez rada**:
Radni dan u kom period nema nijednu stavku. Za njega se ne pravi izvještaj, a mentor dobija samo kratko obavještenje. Utvrđuje se po pravilu za samostalno slanje, najranije u 23:40.

**Stavka**:
Jedna urađena stvar u izvještaju. Ima broj, kratak opis i detalj, a može imati projekat i dokaze.
_Izbjegavaj_: zadatak, task, tačka

**Broj stavke**:
Redni broj stavke u izvještaju (1, 2, 3...). Isti je u sažetku i u detaljnom izvještaju, pa detalj broj 2 uvijek objašnjava kratak opis broj 2.

**Kratak opis**:
Jedan red koji kaže šta je urađeno u stavci.

**Detalj**:
Duže objašnjenje jedne stavke: šta je urađeno i zašto.

**Sažetak**:
Spisak kratkih opisa svih stavki jednog izvještaja. Ide mentoru na Telegram.
_Izbjegavaj_: executive summary, rezime

**Detaljan izvještaj**:
Spisak detalja svih stavki jednog izvještaja, objavljen na sajtu.

**Projekat**:
Posao kojem stavka pripada, npr. "Distill analiza" ili "Agent za izvještaje". Agent ga bira iz spiska projekata i ne izmišlja nove.
_Izbjegavaj_: repo (jedan projekat može imati više repoa)

**Spisak projekata**:
Zatvoren spisak imena projekata i njihovih repoa koji vodi Nemanja. Agent čita samo repoe sa ovog spiska.

**Spisak zabranjenih pojmova**:
Privatan spisak pojmova, npr. imena klijenata, koje izvještaj ne smije da sadrži. Vodi ga Nemanja.

**Dokaz**:
Link ka nečemu što pokazuje da je stavka urađena, npr. issue, PR ili commit. Uz link ide kratka oznaka, npr. "PR #12". Smije da vodi samo na adrese sa spiska dozvoljenih linkova.

**Spisak dozvoljenih linkova**:
Zatvoren spisak adresa na koje izvještaj smije da vodi, u dokazima i u detaljima. Vodi ga Nemanja.

**Bilješka sesije**:
Kratak zapis o jednom dijelu rada u Claude sesiji koji napiše Claude dok sesija još traje, jer sesija nema pravi kraj. Jedna sesija može imati više bilješki. Ulazi u izvještaj samo ako joj je projekat aktivan. Bilješka je ono što agent čita, a sažetak je ono što mentor dobija. Bilješka se nikad ne objavljuje.
_Izbjegavaj_: sažetak sesije (sudara se sa pojmom sažetak)

**Arhiva**:
Spisak svih objavljenih izvještaja po datumima.

**Posljednja aktivnost**:
Trenutak posljednje poruke ili završenog odgovora u Claude Code razgovoru. To je samo vrijeme, bez ičega iz razgovora.

**Pauza**:
Vrijeme proteklo od posljednje aktivnosti. Svjež rad na GitHub-u ili nova bilješka sesije odlažu pitanje o završetku, ali ne mijenjaju posljednju aktivnost.
_Izbjegavaj_: neaktivnost, idle

**Svjež rad**:
Nemanjin rad na GitHub-u ili bilješka sesije u tekućem periodu izvještaja, iz repoa i projekata sa spiska aktivnih. Ne računaju se tuđi rad, rad botova, commitovi agenta ni commitovi koji mijenjaju samo folder bilješki, `pitanja-o-radu/` ili signal rada, a bilješka se računa preko svog foldera i svog vremena.

**Zatvoren dan**:
Radni dan za koji je izvještaj objavljen i mentor je dobio poruku. Zatvoren je i dan bez rada, kad je mentor dobio "Danas nema zabilježenog rada". Tog dana nema više pitanja o završetku ni slanja, a rad poslije toga ulazi u sljedeći izvještaj. Pitanja o radu i dalje rade.

**Pitanje o završetku**:
Poruka kojom agent pita Nemanju da li je završio za danas.

**Javljanje o završetku**:
Nemanjin odgovor da je završio za danas, dugmetom na pitanje o završetku ili porukom "završio" poslatom botu u bilo kom trenutku. Izvještaj zbog njega kreće odmah. "završio" poslije ponoći zatvara radni dan koji je u toku.

**Radni dan**:
Dan na koji se odnose izvještaj, pitanje o završetku i "završio". Traje do slanja izvještaja, a najkasnije do 1:00, pa rad i "završio" poslije ponoći pripadaju radnom danu koji je u toku. Poslije slanja počinje novi radni dan.
_Izbjegavaj_: kalendarski dan (osim za dnevni limit pitanja o radu)

**Samostalno slanje**:
Slanje izvještaja bez "završio". Kreće tek poslije 23:00, kad prođe 40 minuta bez rada, i to najranije u 23:40, a najkasnije u 1:00. Rad za ovo pravilo je posljednja aktivnost, svjež rad i signal rada. Izvještaj poslat poslije ponoći ide mentoru bez zvuka.

**Odloženo slanje**:
Stanje radnog dana poslije Nemanjine poruke "odloži". Nema pitanja o završetku ni samostalnog slanja poslije 40 minuta bez rada, nego izvještaj ide na "završio", a najkasnije u 1:00. Rezerva za rad koji agent ne vidi.

**Signal rada**:
Commit fajla `signal-rada.json` u privatnom repou, koji Claude na claude.ai upiše poslije 22:30, na oko 20 minuta rada. Računa se vrijeme commita, a ne vrijeme u fajlu. Signal je samo aktivnost za samostalno slanje i nikad ne ulazi u izvještaj.

**Pitanje o radu**:
Poruka botu kojom mentor ili Nemanja pita šta je Nemanja uradio. Sa mentorovog chata svaka poruka je pitanje o radu, a sa Nemanjinog svaka osim "završio" i "odloži". Ne mijenja stanje radnog dana.
_Izbjegavaj_: pitanje (samo, sudara se sa pojmom pitanje o završetku), upit

**Odgovor o radu**:
Kratak odgovor agenta na pitanje o radu, napisan iz izvještaja, bilješki sesija i GitHub-a za posljednjih 30 dana. O Nemanji piše u trećem licu, a uz odgovor iz izvještaja ide link na izvještaj na sajtu. Prolazi istu provjeru kao izvještaj. Pitanja i odgovori o radu se čuvaju u privatnom repou radi provjere.
