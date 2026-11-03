# Progress Report Agent

Agent koji na kraju dana sam napiše izvještaj o Nemanjinom radu i pošalje ga mentoru.

## Jezik

**Mentor**:
Tarik, osoba kojoj su izvještaji namijenjeni.

**Agent**:
Program koji sam sastavlja i objavljuje izvještaje, bez Nemanjine ruke.
_Izbjegavaj_: bot (bot je samo Telegram nalog preko kog agent šalje poruke)

**Izvještaj**:
Pregled rada za jedan dan. Nosi datum dana kad je napisan i sastoji se od spiska stavki.
_Izbjegavaj_: dnevnik, report

**Ručno ispravljen izvještaj**:
Izvještaj koji je napisao agent, a poslije ga je mijenjao čovjek. Nosi i oznaku agenta i oznaku "ručno ispravljeno", a agent ga više nikad ne pregazi.

**Ručno napisan izvještaj**:
Izvještaj koji je čovjek napisao od nule, bez agenta. Nosi samo oznaku "napisano ručno", bez oznake agenta, a agent ga nikad ne pregazi.

**Period izvještaja**:
Vrijeme koje izvještaj pokriva: od prethodnog izvještaja do trenutka pisanja, a ne kalendarski dan.

**Dan bez rada**:
Dan u kom period nema nijednu stavku. Za njega se ne pravi izvještaj, a mentor dobija samo kratko obavještenje.

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
Rad na GitHub-u ili bilješka sesije u tekućem periodu izvještaja, iz repoa i projekata sa spiska aktivnih. Ne računaju se commitovi agenta ni commitovi koji mijenjaju samo folder bilješki, a bilješka se računa preko svog foldera i svog vremena.

**Zatvoren dan**:
Dan za koji je izvještaj objavljen i mentor je dobio poruku. Zatvoren je i dan bez rada, kad je mentor dobio "Danas nema zabilježenog rada". Tog dana nema više pitanja ni slanja, a rad poslije toga ulazi u sljedeći izvještaj.

**Pitanje o završetku**:
Poruka kojom agent pita Nemanju da li je završio za danas.

**Javljanje o završetku**:
Nemanjin odgovor da je završio za danas, dugmetom na pitanje o završetku ili porukom "završio" poslatom botu u bilo kom trenutku. Izvještaj zbog njega kreće odmah.
