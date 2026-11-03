"""Seam 3 iz speca #19: Python agent kao cjelina.

Svaki test napravi privremeni git repo, sa lažnom komandom provjere umjesto prave iz privatnog
repoa, i lažan xAI server. Komanda se pokreće kao što bi je pokrenuo workflow, a gleda se samo
ishod, šta je u repou i šta je stiglo do Groka. Svi podaci su izmišljeni.
"""

import json
import os
import subprocess
import sys
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

SKRIPTA = Path(__file__).resolve().parent.parent / "agent" / "agent.py"
AGENT = "progress-report-agent"
COVJEK = "Neko Drugi"
DATUM = "2030-05-15"
ADRESA_SAJTA = "https://sajt.example.com"
KLJUC = "lazni-kljuc-za-test"

AKTIVAN = "Aktivan projekat"
DRUGI_AKTIVAN = "Drugi aktivan projekat"
NEAKTIVAN = "Neaktivan projekat"
PROJEKTI = [
    {"ime": AKTIVAN, "aktivan": True, "repoi": ["neko/repo"]},
    {"ime": DRUGI_AKTIVAN, "aktivan": True, "repoi": ["neko/drugi-repo"]},
    {"ime": NEAKTIVAN, "aktivan": False},
]
# Lažna provjera odbija svaki fajl sa ovim tekstom, kao što bi prava odbila zabranjen pojam.
POGODAK = "IZMISLJENA-TAJNA-VRIJEDNOST"

LAZNA_PROVJERA = f"""\
import json, os, sys
sys.stderr.reconfigure(encoding="utf-8")
zastavica, fajl = sys.argv[1:]
with open(os.environ["DNEVNIK_PROVJERE"], "a", encoding="utf-8") as dnevnik:
    dnevnik.write(json.dumps({{"zastavica": zastavica, "fajl": fajl, "folder": os.getcwd()}}) + "\\n")
with open(fajl, encoding="utf-8") as ulaz:
    if {POGODAK!r} in ulaz.read():
        print(f"{{fajl}}: tekst ima zabranjen pojam", file=sys.stderr)
        sys.exit(1)
"""
POKVARENA_PROVJERA = "raise ImportError('fali biblioteka')\n"


def stavka(opis="Urađena stvar", projekat=AKTIVAN, **ostalo) -> dict:
    return {"kratak_opis": opis, "detalj": f"Detalj: {opis}", "projekat": projekat, **ostalo}


def odgovor_groka(stavke) -> dict:
    return {"choices": [{"message": {"content": json.dumps({"stavke": stavke})}}]}


class LazniGrok:
    """Vraća redom zadate odgovore, a posljednji ponavlja. Pamti sve što mu je poslato."""

    def __init__(self):
        self.zahtjevi: list[dict] = []
        self.zaglavlja: list = []
        self.odgovori: list[tuple[int, bytes]] = []
        self.vrati(odgovor_groka([stavka()]))

    def vrati(self, *sadrzaji) -> None:
        self.odgovori = [(200, json.dumps(sadrzaj).encode()) for sadrzaj in sadrzaji]

    def vrati_sirovo(self, *odgovori: tuple[int, bytes]) -> None:
        self.odgovori = list(odgovori)

    def poslato(self) -> str:
        return json.dumps(self.zahtjevi, ensure_ascii=False)

    def biljeske(self) -> list[dict]:
        return json.loads(self.zahtjevi[-1]["messages"][-1]["content"])["biljeske"]


@pytest.fixture
def grok():
    lazni = LazniGrok()

    class Rukovalac(BaseHTTPRequestHandler):
        def do_POST(self):
            telo = self.rfile.read(int(self.headers["Content-Length"]))
            lazni.zahtjevi.append(json.loads(telo))
            lazni.zaglavlja.append(dict(self.headers))
            lazni.putanja = self.path
            status, odgovor = (
                lazni.odgovori.pop(0) if len(lazni.odgovori) > 1 else lazni.odgovori[0]
            )
            self.send_response(status)
            self.send_header("Content-Length", str(len(odgovor)))
            self.end_headers()
            self.wfile.write(odgovor)

        def log_message(self, *argumenti):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Rukovalac)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    lazni.adresa = f"http://127.0.0.1:{server.server_port}/v1"
    yield lazni
    server.shutdown()
    server.server_close()


class Repo:
    def __init__(self, putanja: Path, grok: LazniGrok):
        self.putanja = putanja
        self.grok = grok
        self.dnevnik = putanja.parent / "dnevnik-provjere.txt"
        putanja.mkdir()
        self.git("init", "-q", "-b", "main")
        self.zapisi("projekti.json", json.dumps(PROJEKTI, ensure_ascii=False))
        self.zapisi("napravi_sajt.py", LAZNA_PROVJERA)
        self.commit(autor=COVJEK)

    def git(self, *argumenti: str, autor: str = COVJEK) -> None:
        okruzenje = {
            **os.environ,
            "GIT_AUTHOR_NAME": autor,
            "GIT_AUTHOR_EMAIL": "neko@example.com",
            "GIT_COMMITTER_NAME": autor,
            "GIT_COMMITTER_EMAIL": "neko@example.com",
        }
        subprocess.run(["git", *argumenti], cwd=self.putanja, env=okruzenje, check=True)

    def zapisi(self, relativna: str, sadrzaj: str) -> None:
        putanja = self.putanja / relativna
        putanja.parent.mkdir(parents=True, exist_ok=True)
        putanja.write_text(sadrzaj, encoding="utf-8")

    def commit(self, autor: str) -> None:
        self.git("add", "-A", autor=autor)
        self.git("commit", "-q", "--allow-empty", "-m", "Promjena", autor=autor)

    def biljeska(self, prije: timedelta, tekst="Tekst bilješke.", projekat=AKTIVAN) -> str:
        vrijeme = datetime.now(UTC) - prije
        ime = f"{vrijeme:%Y-%m-%dT%H%M%S}-{len(list(self.putanja.glob('biljeske-sesija/*')))}"
        self.zapisi(
            f"biljeske-sesija/{ime}.json",
            json.dumps(
                {
                    "vrijeme": vrijeme.isoformat(timespec="minutes"),
                    "projekat": projekat,
                    "tekst": tekst,
                },
                ensure_ascii=False,
            ),
        )
        return tekst

    def izvjestaj(self, datum: str, autor: str, kraj: datetime | None = None) -> str:
        """Commit-uje izvještaj i vraća kraj njegovog perioda."""
        kraj = kraj or datetime.now(UTC) - timedelta(hours=1)
        do = kraj.isoformat(timespec="minutes")
        self.zapisi(
            f"izvjestaji/{datum}.json",
            json.dumps(
                {
                    "verzija_formata": 1,
                    "datum": datum,
                    "period": {"od": (kraj - timedelta(days=1)).isoformat(), "do": do},
                    "broj_stavki": 2,
                    "stavke": [stavka("Prva stvar"), stavka("Druga stvar")],
                },
                ensure_ascii=False,
            ),
        )
        self.commit(autor)
        return do

    def okruzenje(self) -> dict:
        return {
            **os.environ,
            "XAI_API_KEY": KLJUC,
            "XAI_ADRESA": self.grok.adresa,
            "XAI_PAUZA": "0",
            "DNEVNIK_PROVJERE": str(self.dnevnik),
        }

    def pokreni(self, *argumenti: str, okruzenje: dict | None = None):
        return subprocess.run(
            [sys.executable, str(SKRIPTA), *argumenti],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=okruzenje or self.okruzenje(),
        )

    def pisi(self, datum: str = DATUM, okruzenje: dict | None = None) -> dict:
        rezultat = self.pokreni(
            "pisi", "--datum", datum, "--repo", str(self.putanja), okruzenje=okruzenje
        )
        izlaz = json.loads(rezultat.stdout)
        assert rezultat.returncode == (1 if izlaz["ishod"] == "neuspjeh" else 0)
        return izlaz

    def poruka(self, datum: str = DATUM) -> subprocess.CompletedProcess:
        return self.pokreni(
            "poruka", "--datum", datum, "--repo", str(self.putanja), "--adresa-sajta", ADRESA_SAJTA
        )

    def procitaj_izvjestaj(self, datum: str = DATUM) -> dict:
        return json.loads(
            (self.putanja / f"izvjestaji/{datum}.json").read_text(encoding="utf-8")
        )

    def fajlovi_izvjestaja(self) -> list[str]:
        return sorted(p.name for p in (self.putanja / "izvjestaji").glob("*"))

    def provjere(self) -> list[dict]:
        if not self.dnevnik.exists():
            return []
        return [json.loads(red) for red in self.dnevnik.read_text(encoding="utf-8").splitlines()]


@pytest.fixture
def repo(tmp_path, grok) -> Repo:
    return Repo(tmp_path / "privatni-repo", grok)


def tvrdi_neuspjeh_bez_fajla(repo: Repo, izlaz: dict) -> None:
    assert izlaz["ishod"] == "neuspjeh"
    assert not (repo.putanja / f"izvjestaji/{DATUM}.json").exists()
    assert not (repo.putanja / f"izvjestaji/{DATUM}.nacrt").exists()
    assert "nema rada" not in json.dumps(izlaz, ensure_ascii=False).lower()


def test_novi_fajl_sa_podacima_koje_upisuje_python(repo, grok):
    repo.biljeska(timedelta(hours=2))
    grok.vrati(odgovor_groka([stavka("Prva"), stavka("Druga", DRUGI_AKTIVAN)]))
    prije = datetime.now(UTC).replace(second=0, microsecond=0)

    izlaz = repo.pisi()
    poslije = datetime.now(UTC)

    assert izlaz["ishod"] == "novi-fajl"
    assert izlaz["fajl"] == f"izvjestaji/{DATUM}.json"
    izvjestaj = repo.procitaj_izvjestaj()
    assert izvjestaj["verzija_formata"] == 1
    assert izvjestaj["datum"] == DATUM
    assert izvjestaj["broj_stavki"] == 2
    assert [s["kratak_opis"] for s in izvjestaj["stavke"]] == ["Prva", "Druga"]
    assert [s["projekat"] for s in izvjestaj["stavke"]] == [AKTIVAN, DRUGI_AKTIVAN]
    assert izvjestaj["stavke"][0]["detalj"] == "Detalj: Prva"

    do = datetime.fromisoformat(izvjestaj["period"]["do"])
    assert prije <= do <= poslije
    assert do.utcoffset() == do.astimezone(ZoneInfo("Europe/Belgrade")).utcoffset()
    assert do - datetime.fromisoformat(izvjestaj["period"]["od"]) == timedelta(hours=24)


def test_python_ne_uzima_od_groka_nista_osim_polja_stavke(repo, grok):
    repo.biljeska(timedelta(hours=2))
    sadrzaj = {"stavke": [stavka(datum="1999-01-01", broj=7)], "broj_stavki": 9, "datum": "1999-01-01"}
    grok.vrati({"choices": [{"message": {"content": json.dumps(sadrzaj)}}]})

    assert repo.pisi()["ishod"] == "novi-fajl"

    izvjestaj = repo.procitaj_izvjestaj()
    assert izvjestaj["datum"] == DATUM
    assert izvjestaj["broj_stavki"] == 1
    assert set(izvjestaj["stavke"][0]) == {"kratak_opis", "detalj", "projekat"}


def test_zahtjev_groku_ima_model_semu_i_kljuc(repo, grok):
    repo.biljeska(timedelta(hours=2))

    repo.pisi()

    zahtjev = grok.zahtjevi[0]
    assert grok.putanja == "/v1/chat/completions"
    assert grok.zaglavlja[0]["Authorization"] == f"Bearer {KLJUC}"
    assert zahtjev["model"] == "grok-4.7"
    assert zahtjev["response_format"]["type"] == "json_schema"
    sema = zahtjev["response_format"]["json_schema"]["schema"]
    polja = sema["properties"]["stavke"]["items"]["properties"]
    assert set(polja) == {"kratak_opis", "detalj", "projekat"}
    assert polja["projekat"]["enum"] == [AKTIVAN, DRUGI_AKTIVAN]


def test_groku_idu_samo_biljeske_sa_aktivnim_projektom_iz_perioda(repo, grok):
    aktivna = repo.biljeska(timedelta(hours=2), "Rad na aktivnom projektu.")
    repo.biljeska(timedelta(hours=2), "Rad na neaktivnom projektu.", NEAKTIVAN)
    repo.biljeska(timedelta(hours=2), "Rad na nepoznatom projektu.", "Nepoznat posao")
    repo.biljeska(timedelta(hours=25), "Stari rad, prije perioda.")
    repo.biljeska(timedelta(hours=-2), "Rad poslije kraja perioda.")

    izlaz = repo.pisi()

    assert izlaz["ishod"] == "novi-fajl"
    assert izlaz["upozorenja"] == []
    assert [b["tekst"] for b in grok.biljeske()] == [aktivna]
    assert NEAKTIVAN not in grok.poslato()
    assert "Nepoznat posao" not in grok.poslato()


def test_samo_biljeske_neaktivnih_projekata_su_dan_bez_rada(repo, grok):
    repo.biljeska(timedelta(hours=2), "Privatan rad.", NEAKTIVAN)
    repo.biljeska(timedelta(hours=2), f"Privatan rad sa {POGODAK}.", "Nepoznat posao")

    izlaz = repo.pisi()

    assert izlaz["ishod"] == "dan-bez-rada"
    assert izlaz["upozorenja"] == []
    assert grok.zahtjevi == []


def test_biljeska_sa_pogotkom_ne_ide_groku_a_upozorenje_nema_vrijednost(repo, grok):
    dobra = repo.biljeska(timedelta(hours=3), "Dobra bilješka.")
    repo.biljeska(timedelta(hours=2), f"Bilješka sa {POGODAK} u tekstu.")

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    assert izlaz["ishod"] == "novi-fajl"
    assert [b["tekst"] for b in grok.biljeske()] == [dobra]
    assert POGODAK not in grok.poslato()
    assert len(izlaz["upozorenja"]) == 1
    assert izlaz["upozorenja"][0].startswith("biljeske-sesija/")
    assert "zabranjen pojam" in izlaz["upozorenja"][0]
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_samo_biljeske_sa_pogotkom_su_neuspjeh_a_ne_dan_bez_rada(repo, grok):
    repo.biljeska(timedelta(hours=2), f"Bilješka sa {POGODAK} u tekstu.")

    izlaz = repo.pisi()

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert grok.zahtjevi == []
    assert len(izlaz["upozorenja"]) == 1


@pytest.mark.parametrize(
    "sadrzaj",
    [
        "nije json",
        "[]",
        json.dumps({"projekat": AKTIVAN, "vrijeme": "2030-05-15T10:00", "tekst": POGODAK}),
        json.dumps({"projekat": AKTIVAN, "vrijeme": POGODAK, "tekst": "Tekst."}),
        json.dumps({"projekat": 7, "vrijeme": "2030-05-15T10:00+01:00", "tekst": POGODAK}),
    ],
)
def test_neispravna_biljeska_ne_ide_groku_a_upozorenje_nema_vrijednost(repo, grok, sadrzaj):
    dobra = repo.biljeska(timedelta(hours=2), "Dobra bilješka.")
    repo.zapisi("biljeske-sesija/pokvarena.json", sadrzaj)

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    assert izlaz["ishod"] == "novi-fajl"
    assert [b["tekst"] for b in grok.biljeske()] == [dobra]
    assert len(izlaz["upozorenja"]) == 1
    assert izlaz["upozorenja"][0].startswith("biljeske-sesija/pokvarena.json: ")
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_provjera_se_poziva_iz_privatnog_repoa(repo):
    repo.biljeska(timedelta(hours=2))

    repo.pisi()

    pozivi = repo.provjere()
    assert [poziv["zastavica"] for poziv in pozivi] == ["--provjeri-biljesku", "--provjeri"]
    assert all(Path(poziv["folder"]).resolve() == repo.putanja.resolve() for poziv in pozivi)


def test_pokvarena_provjera_biljeske_je_neuspjeh_a_ne_dan_bez_rada(repo, grok):
    repo.biljeska(timedelta(hours=2))
    repo.zapisi("napravi_sajt.py", POKVARENA_PROVJERA)

    izlaz = repo.pisi()

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert grok.zahtjevi == []


def test_nema_ulaza_je_dan_bez_rada_i_grok_nije_pozvan_ni_bez_kljuca(repo, grok):
    okruzenje = repo.okruzenje()
    del okruzenje["XAI_API_KEY"]

    izlaz = repo.pisi(okruzenje=okruzenje)

    assert izlaz["ishod"] == "dan-bez-rada"
    assert grok.zahtjevi == []
    assert not (repo.putanja / "izvjestaji").exists()


def test_bez_kljuca_a_sa_ulazom_je_neuspjeh(repo):
    repo.biljeska(timedelta(hours=2))
    okruzenje = repo.okruzenje()
    del okruzenje["XAI_API_KEY"]

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi(okruzenje=okruzenje))


def test_grok_ne_odgovara_poslije_ponovljenih_pokusaja(repo, grok):
    repo.biljeska(timedelta(hours=2))
    grok.vrati_sirovo((500, b"greska"))

    izlaz = repo.pisi()

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert len(grok.zahtjevi) == 3


def test_grok_ne_postoji_na_mrezi(repo, grok):
    repo.biljeska(timedelta(hours=2))
    okruzenje = {**repo.okruzenje(), "XAI_ADRESA": "http://127.0.0.1:1/v1"}

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi(okruzenje=okruzenje))


def test_grok_odgovori_iz_drugog_pokusaja(repo, grok):
    repo.biljeska(timedelta(hours=2))
    grok.vrati_sirovo((503, b"greska"), (200, json.dumps(odgovor_groka([stavka()])).encode()))

    assert repo.pisi()["ishod"] == "novi-fajl"
    assert len(grok.zahtjevi) == 2


def test_odbijen_zahtjev_se_ne_ponavlja(repo, grok):
    repo.biljeska(timedelta(hours=2))
    grok.vrati_sirovo((401, b"pogresan kljuc"))

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())
    assert len(grok.zahtjevi) == 1


@pytest.mark.parametrize(
    "odgovor",
    [
        odgovor_groka([]),
        odgovor_groka([stavka(projekat=f"Izmišljen {POGODAK}")]),
        odgovor_groka([stavka(projekat=NEAKTIVAN)]),
        odgovor_groka([{"kratak_opis": "Bez detalja i projekta"}]),
        odgovor_groka([{**stavka(), "kratak_opis": "  "}]),
        odgovor_groka("nije spisak"),
        {"choices": [{"message": {"content": f"nije json {POGODAK}"}}]},
        {"choices": []},
    ],
    ids=[
        "prazan-spisak",
        "nepoznat-projekat",
        "neaktivan-projekat",
        "bez-polja",
        "prazan-opis",
        "stavke-nisu-spisak",
        "sadrzaj-nije-json",
        "bez-odgovora",
    ],
)
def test_los_odgovor_groka_je_neuspjeh(repo, grok, odgovor):
    repo.biljeska(timedelta(hours=2))
    grok.vrati(odgovor)

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))

    tvrdi_neuspjeh_bez_fajla(repo, json.loads(rezultat.stdout))
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_fajl_koji_ne_prodje_provjeru_je_neuspjeh(repo, grok):
    primjer = repo.izvjestaj("2030-01-01", COVJEK)
    repo.biljeska(timedelta(hours=2))
    grok.vrati(odgovor_groka([stavka(f"Stavka sa {POGODAK}")]))

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert "zabranjen pojam" in izlaz["razlog"]
    assert POGODAK not in rezultat.stdout + rezultat.stderr
    # Primjer se briše tek uz fajl koji je prošao provjeru.
    assert repo.procitaj_izvjestaj("2030-01-01")["period"]["do"] == primjer


def test_pokvarena_provjera_izvjestaja_je_neuspjeh(repo, grok):
    repo.biljeska(timedelta(hours=2))
    # Bilješka prolazi, a provjera puca tek na izvještaju.
    repo.zapisi(
        "napravi_sajt.py", "import sys\nsys.exit(0 if sys.argv[1] != '--provjeri' else 3)\n"
    )

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())
    assert len(grok.zahtjevi) == 1


@pytest.mark.parametrize(
    "autori",
    [[AGENT], [AGENT, COVJEK], [COVJEK]],
    ids=["agentov", "rucno-ispravljen", "rucno-napisan"],
)
def test_postojeci_fajl_se_ne_pise_i_grok_se_ne_zove(repo, grok, autori):
    repo.biljeska(timedelta(hours=2))
    for autor in autori:
        repo.izvjestaj(DATUM, autor, datetime.now(UTC) - timedelta(minutes=len(autor)))
    prije = (repo.putanja / f"izvjestaji/{DATUM}.json").read_bytes()

    izlaz = repo.pisi()

    assert izlaz["ishod"] == "postoji-fajl"
    assert izlaz["fajl"] == f"izvjestaji/{DATUM}.json"
    assert grok.zahtjevi == []
    assert repo.provjere() == []
    assert (repo.putanja / f"izvjestaji/{DATUM}.json").read_bytes() == prije


def test_period_ide_od_kraja_prethodnog_izvjestaja(repo, grok):
    kraj = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(hours=30)
    repo.izvjestaj("2030-05-14", AGENT, kraj)
    repo.izvjestaj("2030-05-13", AGENT, kraj - timedelta(days=1))
    repo.biljeska(datetime.now(UTC) - (kraj - timedelta(minutes=1)), "Prije kraja prethodnog.")
    repo.biljeska(datetime.now(UTC) - kraj, "Baš u minutu kraja prethodnog.")
    repo.biljeska(timedelta(hours=26), "Poslije prethodnog, stara više od 24 sata.")

    assert repo.pisi()["ishod"] == "novi-fajl"

    assert [b["tekst"] for b in grok.biljeske()] == [
        "Baš u minutu kraja prethodnog.",
        "Poslije prethodnog, stara više od 24 sata.",
    ]
    assert datetime.fromisoformat(repo.procitaj_izvjestaj()["period"]["od"]) == kraj


def test_rucno_napisan_izvjestaj_poslije_agentovog_je_prethodni_i_ostaje(repo, grok):
    repo.izvjestaj("2030-05-13", AGENT, datetime.now(UTC) - timedelta(hours=40))
    kraj = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(hours=3)
    repo.izvjestaj("2030-05-14", COVJEK, kraj)
    repo.biljeska(timedelta(hours=5), "Prije ručno napisanog.")
    repo.biljeska(timedelta(hours=2), "Poslije ručno napisanog.")

    izlaz = repo.pisi()

    assert izlaz["obrisani"] == []
    assert [b["tekst"] for b in grok.biljeske()] == ["Poslije ručno napisanog."]
    assert datetime.fromisoformat(repo.procitaj_izvjestaj()["period"]["od"]) == kraj
    assert repo.fajlovi_izvjestaja() == ["2030-05-13.json", "2030-05-14.json", f"{DATUM}.json"]


def test_poslije_obrisanih_izvjestaja_iz_probe_period_je_24_sata(repo, grok):
    repo.izvjestaj("2030-05-14", AGENT, datetime.now(UTC) - timedelta(hours=40))
    (repo.putanja / "izvjestaji/2030-05-14.json").unlink()
    repo.commit(COVJEK)
    repo.biljeska(timedelta(hours=30), "Starija od 24 sata.")
    repo.biljeska(timedelta(hours=20), "Mlađa od 24 sata.")

    assert repo.pisi()["ishod"] == "novi-fajl"

    assert [b["tekst"] for b in grok.biljeske()] == ["Mlađa od 24 sata."]
    period = repo.procitaj_izvjestaj()["period"]
    trajanje = datetime.fromisoformat(period["do"]) - datetime.fromisoformat(period["od"])
    assert trajanje == timedelta(hours=24)


def test_prvi_izvjestaj_agenta_ne_racuna_i_brise_rucne_primjere(repo, grok):
    # Primjeri su ovdje noviji od bilješke, pa bi je kao prethodni izvještaj izbacili iz perioda.
    repo.izvjestaj("2030-05-13", COVJEK, datetime.now(UTC) - timedelta(hours=2))
    repo.izvjestaj("2030-05-14", COVJEK, datetime.now(UTC) - timedelta(hours=1))
    biljeska = repo.biljeska(timedelta(hours=5))

    izlaz = repo.pisi()

    assert izlaz["ishod"] == "novi-fajl"
    assert sorted(izlaz["obrisani"]) == ["izvjestaji/2030-05-13.json", "izvjestaji/2030-05-14.json"]
    assert [b["tekst"] for b in grok.biljeske()] == [biljeska]
    assert repo.fajlovi_izvjestaja() == [f"{DATUM}.json"]
    period = repo.procitaj_izvjestaj()["period"]
    trajanje = datetime.fromisoformat(period["do"]) - datetime.fromisoformat(period["od"])
    assert trajanje == timedelta(hours=24)


def test_dan_bez_rada_ne_brise_rucne_primjere(repo):
    repo.izvjestaj("2030-05-14", COVJEK)

    assert repo.pisi()["ishod"] == "dan-bez-rada"
    assert repo.fajlovi_izvjestaja() == ["2030-05-14.json"]


def test_rucno_napisan_izvjestaj_za_datum_prvog_izvjestaja_ostaje_sa_primjerima(repo, grok):
    repo.izvjestaj("2030-05-14", COVJEK)
    repo.izvjestaj(DATUM, COVJEK)
    repo.biljeska(timedelta(hours=2))

    assert repo.pisi()["ishod"] == "postoji-fajl"
    assert repo.fajlovi_izvjestaja() == ["2030-05-14.json", f"{DATUM}.json"]


def test_plitka_kopija_je_neuspjeh_i_nista_se_ne_brise(repo, tmp_path, grok):
    repo.izvjestaj("2030-05-13", AGENT)
    repo.izvjestaj("2030-05-14", COVJEK)
    kopija = tmp_path / "plitka-kopija"
    subprocess.run(
        ["git", "clone", "-q", "--depth", "1", repo.putanja.as_uri(), str(kopija)], check=True
    )
    repo.putanja = kopija
    repo.biljeska(timedelta(minutes=30))

    izlaz = repo.pisi()

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert grok.zahtjevi == []
    assert repo.fajlovi_izvjestaja() == ["2030-05-13.json", "2030-05-14.json"]


def test_folder_unutar_drugog_repoa_je_neuspjeh(repo):
    podfolder = repo.putanja / "podfolder"
    podfolder.mkdir()

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(podfolder))

    assert json.loads(rezultat.stdout)["ishod"] == "neuspjeh"
    assert rezultat.returncode == 1


def test_neispravan_prethodni_izvjestaj_je_neuspjeh(repo):
    repo.izvjestaj("2030-05-13", AGENT)
    repo.zapisi("izvjestaji/2030-05-14.json", json.dumps({"period": {"do": POGODAK}}))
    repo.biljeska(timedelta(hours=2))

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))

    tvrdi_neuspjeh_bez_fajla(repo, json.loads(rezultat.stdout))
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_pokvaren_spisak_projekata_je_neuspjeh_a_ne_dan_bez_rada(repo):
    repo.zapisi("projekti.json", "nije json")

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())


@pytest.mark.parametrize("datum", ["15.5.2030.", "2030-13-45", "../../2030-05-15", ""])
def test_neispravan_datum_je_neuspjeh(repo, grok, datum):
    repo.biljeska(timedelta(hours=2))

    izlaz = repo.pisi(datum)

    assert izlaz["ishod"] == "neuspjeh"
    assert grok.zahtjevi == []


def test_poruka_za_izvjestaj_agenta(repo):
    repo.izvjestaj(DATUM, AGENT)

    rezultat = repo.poruka()

    assert rezultat.returncode == 0
    assert rezultat.stdout.strip() == (
        "🤖 Izvještaj za 15.5.2030.\n\n"
        "1. Prva stvar\n"
        "2. Druga stvar\n\n"
        f"{ADRESA_SAJTA}/izvjestaji/{DATUM}/"
    )


def test_poruka_za_rucno_ispravljen_izvjestaj_ostaje_agentova(repo):
    repo.izvjestaj(DATUM, AGENT, datetime.now(UTC) - timedelta(hours=2))
    repo.izvjestaj(DATUM, COVJEK, datetime.now(UTC) - timedelta(hours=1))

    izlaz = repo.poruka().stdout

    assert izlaz.startswith("🤖 ")
    assert "napisano ručno" not in izlaz


def test_poruka_za_rucno_napisan_izvjestaj(repo):
    repo.izvjestaj(DATUM, COVJEK)

    rezultat = repo.poruka()

    assert rezultat.returncode == 0
    assert "✍️ Izvještaj (napisano ručno)" in rezultat.stdout
    assert "🤖" not in rezultat.stdout
    assert "1. Prva stvar\n2. Druga stvar" in rezultat.stdout
    assert f"{ADRESA_SAJTA}/izvjestaji/{DATUM}/" in rezultat.stdout


def test_poruka_bez_fajla_je_greska(repo):
    rezultat = repo.poruka()

    assert rezultat.returncode == 1
    assert rezultat.stdout == ""
