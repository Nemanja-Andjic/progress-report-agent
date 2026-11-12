"""Seam 3 iz speca #19: Python agent kao cjelina.

Svaki test napravi privremeni git repo, sa lažnom komandom provjere umjesto prave iz privatnog
repoa, i lažne xAI i GitHub servere. Komanda se pokreće kao što bi je pokrenuo workflow, a gleda se
samo ishod, šta je u repou i šta je stiglo do Groka. Svi podaci su izmišljeni.
"""

import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta
from hashlib import sha1
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import pytest

SKRIPTA = Path(__file__).resolve().parent.parent / "agent" / "agent.py"
AGENT = "progress-report-agent"
COVJEK = "Neko Drugi"
DATUM = "2030-05-15"
ADRESA_SAJTA = "https://sajt.example.com"
KLJUC = "lazni-kljuc-za-test"
TOKEN_GITHUBA = "lazni-token-githuba-za-test"
NALOG = "Nemanja-Andjic"
TUDJI_NALOG = "neko-drugi"
BOT = "dependabot[bot]"
REPO = "neko/repo"
DRUGI_REPO = "neko/drugi-repo"
NEAKTIVAN_REPO = "neko/neaktivan-repo"
DOZVOLJEN_LINK = "https://github.com/neko/"

AKTIVAN = "Aktivan projekat"
DRUGI_AKTIVAN = "Drugi aktivan projekat"
NEAKTIVAN = "Neaktivan projekat"
PROJEKTI = [
    {"ime": AKTIVAN, "aktivan": True, "repoi": [REPO]},
    {"ime": DRUGI_AKTIVAN, "aktivan": True, "repoi": [DRUGI_REPO]},
    {"ime": NEAKTIVAN, "aktivan": False, "repoi": [NEAKTIVAN_REPO]},
]
# Lažna provjera odbija svaki fajl sa ovim tekstom, kao što bi prava odbila zabranjen pojam.
POGODAK = "IZMISLJENA-TAJNA-VRIJEDNOST"
# Za bilješku lažna provjera prepoznaje i obrazac tajne i putanju, sa porukama prave provjere.
TAJNA = "IZMISLJEN-OBRAZAC-KLJUCA"
PUTANJA = "IZMISLJENA-PUTANJA-SA-RACUNARA"

LAZNA_PROVJERA = f"""\
import json, os, sys
sys.stderr.reconfigure(encoding="utf-8")
zastavica, fajl = sys.argv[1:]
with open(os.environ["DNEVNIK_PROVJERE"], "a", encoding="utf-8") as dnevnik:
    dnevnik.write(json.dumps({{"zastavica": zastavica, "fajl": fajl, "folder": os.getcwd()}}) + "\\n")
with open(fajl, encoding="utf-8") as ulaz:
    sadrzaj = ulaz.read()
if zastavica == "--provjeri-biljesku":
    greske = []
    if {TAJNA!r} in sadrzaj:
        greske.append("tekst ima obrazac tajne ili ključa")
    if {PUTANJA!r} in sadrzaj:
        greske.append("tekst ima putanju sa računara")
    if {POGODAK!r} in sadrzaj:
        greske.append("tekst ima zabranjen pojam")
    if len(str(json.loads(sadrzaj).get("tekst"))) > 2000:
        greske.append("tekst je duži od 2000 znakova")
else:
    greske = []
    for i, stavka in enumerate(json.loads(sadrzaj)["stavke"]):
        if {POGODAK!r} in stavka["kratak_opis"] + stavka["detalj"]:
            greske.append(f"stavke[{{i}}].kratak_opis ima zabranjen pojam")
        for j, dokaz in enumerate(stavka.get("dokazi", [])):
            if {POGODAK!r} in dokaz["link"]:
                greske.append(f"stavke[{{i}}].dokazi[{{j}}].link ima zabranjen pojam")
            if not dokaz["link"].startswith({DOZVOLJEN_LINK!r}):
                greske.append(f"stavke[{{i}}].dokazi[{{j}}].link nije na spisku dozvoljenih linkova")
for greska in greske:
    print(f"{{fajl}}: {{greska}}", file=sys.stderr)
sys.exit(1 if greske else 0)
"""
POKVARENA_PROVJERA = "raise ImportError('fali biblioteka')\n"


def stavka(opis="Urađena stvar", projekat=AKTIVAN, dokazi=(), **ostalo) -> dict:
    return {
        "kratak_opis": opis,
        "detalj": f"Detalj: {opis}",
        "projekat": projekat,
        "dokazi": list(dokazi),
        **ostalo,
    }


def odgovor_sa_tekstom(tekst: str, status="completed") -> dict:
    return {
        "status": status,
        "output": [
            {"type": "reasoning", "summary": []},
            {"type": "message", "content": [{"type": "output_text", "text": tekst}]},
        ],
    }


def odgovor_groka(stavke) -> dict:
    return odgovor_sa_tekstom(json.dumps({"stavke": stavke}))


class LazniGrok:
    """Vraća redom zadate odgovore, a posljednji ponavlja. Pamti sve što mu je poslato."""

    def __init__(self):
        self.zahtjevi: list[dict] = []
        self.zaglavlja: list = []
        self.odgovori: list[tuple[int, bytes]] = []
        self.kasnjenje = 0.0
        self.vrati(odgovor_groka([stavka()]))

    def vrati(self, *sadrzaji) -> None:
        self.odgovori = [(200, json.dumps(sadrzaj).encode()) for sadrzaj in sadrzaji]

    def vrati_sirovo(self, *odgovori: tuple[int, bytes]) -> None:
        self.odgovori = list(odgovori)

    def poslato(self) -> str:
        return json.dumps(self.zahtjevi, ensure_ascii=False)

    def ulaz(self) -> dict:
        return json.loads(self.zahtjevi[-1]["input"][-1]["content"])

    def biljeske(self) -> list[dict]:
        return self.ulaz()["biljeske"]

    def github(self) -> list[dict]:
        return self.ulaz()["github"]


@pytest.fixture
def grok():
    lazni = LazniGrok()

    class Rukovalac(BaseHTTPRequestHandler):
        def do_POST(self):
            telo = self.rfile.read(int(self.headers["Content-Length"]))
            lazni.zahtjevi.append(json.loads(telo))
            lazni.zaglavlja.append(dict(self.headers))
            lazni.putanja = self.path
            time.sleep(lazni.kasnjenje)
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


def vrijeme_githuba(prije: timedelta) -> str:
    return (datetime.now(UTC) - prije).strftime("%Y-%m-%dT%H:%M:%SZ")


class LazniGithub:
    """Vraća zadate issue-e, PR-ove i commitove po stranicama. Pamti sve što je traženo."""

    def __init__(self):
        self.issues: dict[str, list[dict]] = {}
        self.grane: dict[str, dict[str, list[dict]]] = {}
        self.fajlovi: dict[str, list[dict]] = {}
        self.velicina_strane = 100
        self.greske: list[dict] = []
        self.pokvareno: dict[str, tuple[int, bytes]] = {}
        self.link_umjesto_sljedece: str | None = None
        self.trazeno: list[str] = []
        self.metode: list[str] = []
        self.tokeni: list[str] = []
        self.broj = 0

    def issue(self, prije=timedelta(hours=2), naslov="Naslov issue-a", tekst="Tekst.", repo=REPO, **ostalo):
        return self._dodaj_issue("issues", prije, naslov, tekst, repo, ostalo)

    def pr(self, prije=timedelta(hours=2), naslov="Naslov PR-a", tekst="Tekst.", repo=REPO, spojen=False, **ostalo):
        merged_at = vrijeme_githuba(prije) if spojen else None
        return self._dodaj_issue(
            "pull", prije, naslov, tekst, repo, {"pull_request": {"merged_at": merged_at}, **ostalo}
        )

    def _dodaj_issue(self, putanja, prije, naslov, tekst, repo, ostalo) -> int:
        self.broj += 1
        self.issues.setdefault(repo, []).append(
            {
                "number": self.broj,
                "title": naslov,
                "body": tekst,
                "state": "open",
                "user": {"login": NALOG},
                "updated_at": vrijeme_githuba(prije),
                "html_url": f"https://github.com/{repo}/{putanja}/{self.broj}",
                **ostalo,
            }
        )
        return self.broj

    def commit(
        self,
        prije=timedelta(hours=2),
        poruka="Poruka commita",
        repo=REPO,
        autor=COVJEK,
        fajlovi=("kod.py",),
        grana="main",
        **ostalo,
    ) -> str:
        self.broj += 1
        sha = sha1(str(self.broj).encode()).hexdigest()
        self.fajlovi[sha] = [{"filename": fajl} for fajl in fajlovi]
        self.dodaj_na_granu(
            grana,
            {
                "sha": sha,
                "html_url": f"https://github.com/{repo}/commit/{sha}",
                "author": {"login": NALOG},
                "commit": {
                    "message": poruka,
                    "author": {"name": autor},
                    "committer": {"date": vrijeme_githuba(prije)},
                },
                **ostalo,
            },
            repo,
        )
        return sha

    def dodaj_na_granu(self, grana: str, commit: dict, repo=REPO) -> None:
        self.grane.setdefault(repo, {}).setdefault(grana, []).append(commit)

    def padni(self, status: int, putanja: str, puta: int = 10**6) -> None:
        self.greske.append({"status": status, "putanja": putanja, "puta": puta})

    def odgovor(self, adresa: str) -> tuple[int, bytes, str | None]:
        dijelovi = urlsplit(adresa)
        upit = parse_qs(dijelovi.query)
        for greska in self.greske:
            if greska["putanja"] in dijelovi.path and greska["puta"] > 0:
                greska["puta"] -= 1
                return greska["status"], b"greska", None
        for dio, (status, sadrzaj) in self.pokvareno.items():
            if dio in dijelovi.path:
                return status, sadrzaj, None

        _, vlasnik, ime, *ostatak = dijelovi.path.strip("/").split("/")
        repo = f"{vlasnik}/{ime}"
        if ostatak == ["issues"]:
            spisak = self.issues.get(repo, [])
        elif ostatak == ["branches"]:
            spisak = [{"name": grana} for grana in self.grane.get(repo, {})]
        elif ostatak == ["commits"]:
            spisak = self.grane[repo][upit["sha"][0]]
        else:
            return self._strana({"files": self.fajlovi[ostatak[1]]}, "files", adresa, upit)
        return self._strana({"spisak": spisak}, "spisak", adresa, upit)

    def _strana(self, sadrzaj: dict, kljuc: str, adresa: str, upit: dict):
        strana = int(upit.get("page", ["1"])[0])
        vel = self.velicina_strane
        clanovi = sadrzaj[kljuc]
        dio = clanovi[(strana - 1) * vel : strana * vel]
        link = None
        if strana * vel < len(clanovi):
            osnova = adresa.split("&page=")[0]
            znak = "&" if "?" in osnova else "?"
            sljedeca = self.link_umjesto_sljedece or f"{self.adresa_servera}{osnova}{znak}page={strana + 1}"
            link = f'<{sljedeca}>; rel="next"'
        return 200, json.dumps(dio if kljuc == "spisak" else {"files": dio}).encode(), link


@pytest.fixture
def github():
    lazni = LazniGithub()

    class Rukovalac(BaseHTTPRequestHandler):
        def do_GET(self):
            lazni.trazeno.append(self.path)
            lazni.metode.append(self.command)
            lazni.tokeni.append(self.headers.get("Authorization"))
            status, odgovor, link = lazni.odgovor(self.path)
            self.send_response(status)
            self.send_header("Content-Length", str(len(odgovor)))
            if link:
                self.send_header("Link", link)
            self.end_headers()
            self.wfile.write(odgovor)

        def log_message(self, *argumenti):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Rukovalac)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    lazni.adresa_servera = f"http://127.0.0.1:{server.server_port}"
    yield lazni
    server.shutdown()
    server.server_close()


class Repo:
    def __init__(self, putanja: Path, grok: LazniGrok, github: LazniGithub):
        self.putanja = putanja
        self.grok = grok
        self.github = github
        self.dnevnik = putanja.parent / "dnevnik-provjere.txt"
        putanja.mkdir()
        self.git("init", "-q", "-b", "main")
        self.zapisi("projekti.json", json.dumps(PROJEKTI, ensure_ascii=False))
        self.zapisi("napravi_sajt.py", LAZNA_PROVJERA)
        self.commit(autor=COVJEK)

    def git(self, *argumenti: str, autor: str = COVJEK, vrijeme: datetime | None = None) -> None:
        okruzenje = {
            **os.environ,
            "GIT_AUTHOR_NAME": autor,
            "GIT_AUTHOR_EMAIL": "neko@example.com",
            "GIT_COMMITTER_NAME": autor,
            "GIT_COMMITTER_EMAIL": "neko@example.com",
        }
        if vrijeme:
            okruzenje["GIT_AUTHOR_DATE"] = okruzenje["GIT_COMMITTER_DATE"] = vrijeme.isoformat()
        subprocess.run(["git", *argumenti], cwd=self.putanja, env=okruzenje, check=True)

    def zapisi(self, relativna: str, sadrzaj: str) -> None:
        putanja = self.putanja / relativna
        putanja.parent.mkdir(parents=True, exist_ok=True)
        putanja.write_text(sadrzaj, encoding="utf-8")

    def commit(self, autor: str, poruka="Promjena", vrijeme: datetime | None = None) -> None:
        self.git("add", "-A", autor=autor)
        self.git("commit", "-q", "--allow-empty", "-m", poruka, autor=autor, vrijeme=vrijeme)

    def signal(self, prije: timedelta, u_fajlu: datetime | None = None) -> datetime:
        """Commit-uje signal rada kao Claude na claude.ai i vraća vrijeme commita.

        Vrijeme u fajlu je namjerno drugačije od vremena commita, kao kad Claude pogriješi sat.
        """
        vrijeme = (datetime.now(UTC) - prije).replace(microsecond=0)
        u_fajlu = u_fajlu or vrijeme + timedelta(hours=3)
        self.zapisi(
            "signal-rada.json",
            json.dumps({"izvor": "claude.ai", "vrijeme": u_fajlu.isoformat(timespec="minutes")}),
        )
        self.commit(COVJEK, "Signal rada", vrijeme)
        return vrijeme

    def biljeska(self, prije: timedelta, tekst="Tekst bilješke.", projekat=AKTIVAN) -> str:
        vrijeme = (datetime.now(UTC) - prije).isoformat(timespec="minutes")
        return self.biljeska_u(vrijeme, tekst, projekat)

    def biljeska_u(self, vrijeme: str, tekst="Tekst bilješke.", projekat=AKTIVAN) -> str:
        # Dvije bilješke mogu da imaju isto vrijeme, pa ime nosi i redni broj.
        ime = f"{datetime.fromisoformat(vrijeme).astimezone(UTC):%Y-%m-%dT%H%M%S}"
        ime = f"{ime}-{len(list(self.putanja.glob('biljeske-sesija/*')))}"
        self.zapisi(
            f"biljeske-sesija/{ime}.json",
            json.dumps(
                {"vrijeme": vrijeme, "projekat": projekat, "tekst": tekst}, ensure_ascii=False
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
            "AGENT_GITHUB_TOKEN": TOKEN_GITHUBA,
            "AGENT_GITHUB_ADRESA": self.github.adresa_servera,
            "AGENT_GITHUB_PAUZA": "0",
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

    def svjez_rad(self, okruzenje: dict | None = None) -> dict:
        rezultat = self.pokreni("svjez-rad", "--repo", str(self.putanja), okruzenje=okruzenje)
        izlaz = json.loads(rezultat.stdout)
        assert rezultat.returncode == (1 if izlaz["ishod"] == "neuspjeh" else 0)
        return izlaz

    def odgovor(
        self, pitanje="Šta je Nemanja radio juče?", chat="mentor", okruzenje: dict | None = None
    ) -> dict:
        rezultat = self.pokreni(
            "odgovor",
            "--chat", chat,
            "--pitanje", pitanje,
            "--repo", str(self.putanja),
            "--adresa-sajta", ADRESA_SAJTA,
            okruzenje=okruzenje,
        )
        izlaz = json.loads(rezultat.stdout)
        assert rezultat.returncode == (1 if izlaz["ishod"] == "neuspjeh" else 0)
        self.izlaz_odgovora = rezultat.stdout + rezultat.stderr
        return izlaz

    def pitanja_o_radu(self) -> list[dict]:
        """Sadržaj svakog fajla odgovora, od najstarijeg, bez podešavanja."""
        folder = self.putanja / "pitanja-o-radu"
        return [
            json.loads(putanja.read_text(encoding="utf-8"))
            for putanja in sorted(folder.glob("*.json"))
            if putanja.name != "podesavanja.json"
        ]

    def zapisi_pitanje_o_radu(self, prije: timedelta, chat="mentor", pitanje="Ranije pitanje?") -> None:
        """Upiše uspješan odgovor kao što ga upisuje komanda, a odgovor je uvijek isti."""
        odgovor = "Raniji odgovor."
        vrijeme = datetime.now(UTC) - prije
        self.zapisi(
            f"pitanja-o-radu/{vrijeme:%Y-%m-%dT%H%M%S}-{chat}.json",
            json.dumps(
                {
                    "vrijeme": vrijeme.isoformat(timespec="seconds"),
                    "chat": chat,
                    "pitanje": pitanje,
                    "odgovor": odgovor,
                    "izvjestaji": [],
                },
                ensure_ascii=False,
            ),
        )

    def podesavanja(self) -> dict | None:
        putanja = self.putanja / "pitanja-o-radu/podesavanja.json"
        return json.loads(putanja.read_text(encoding="utf-8")) if putanja.exists() else None

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
def repo(tmp_path, grok, github) -> Repo:
    return Repo(tmp_path / "privatni-repo", grok, github)


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
    grok.vrati(odgovor_sa_tekstom(json.dumps(sadrzaj)))

    assert repo.pisi()["ishod"] == "novi-fajl"

    izvjestaj = repo.procitaj_izvjestaj()
    assert izvjestaj["datum"] == DATUM
    assert izvjestaj["broj_stavki"] == 1
    assert set(izvjestaj["stavke"][0]) == {"kratak_opis", "detalj", "projekat", "dokazi"}


def test_zahtjev_groku_ima_model_semu_i_kljuc(repo, grok):
    repo.biljeska(timedelta(hours=2))

    repo.pisi()

    zahtjev = grok.zahtjevi[0]
    assert grok.putanja == "/v1/responses"
    assert grok.zaglavlja[0]["Authorization"] == f"Bearer {KLJUC}"
    assert zahtjev["model"] == "grok-4.7"
    assert zahtjev["store"] is False
    assert zahtjev["reasoning"] == {"effort": "low"}
    format_odgovora = zahtjev["text"]["format"]
    assert format_odgovora["type"] == "json_schema"
    assert format_odgovora["strict"] is True
    sema = format_odgovora["schema"]
    polja = sema["properties"]["stavke"]["items"]["properties"]
    assert set(polja) == {"kratak_opis", "detalj", "projekat", "dokazi"}
    assert polja["projekat"]["enum"] == [AKTIVAN, DRUGI_AKTIVAN]
    assert set(sema["properties"]["stavke"]["items"]["required"]) == set(polja)


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
    assert len(grok.zahtjevi) == 2
    assert izlaz["razlog"] == "Grok nije odgovorio ni poslije 2 pokušaja (status 500)."


def test_grok_koji_ne_stigne_u_roku_je_isteklo_vrijeme(repo, grok):
    repo.biljeska(timedelta(hours=2))
    grok.kasnjenje = 1.0
    okruzenje = {**repo.okruzenje(), "XAI_ROK": "0.2"}

    izlaz = repo.pisi(okruzenje=okruzenje)

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert len(grok.zahtjevi) == 2
    assert izlaz["razlog"] == "Grok nije odgovorio ni poslije 2 pokušaja (isteklo vrijeme)."


def test_grok_ne_postoji_na_mrezi(repo, grok):
    repo.biljeska(timedelta(hours=2))
    okruzenje = {**repo.okruzenje(), "XAI_ADRESA": "http://127.0.0.1:1/v1"}

    izlaz = repo.pisi(okruzenje=okruzenje)

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert izlaz["razlog"] == "Grok nije odgovorio ni poslije 2 pokušaja (greška mreže)."


@pytest.fixture
def agent(monkeypatch):
    """Agent kao modul, sa podrazumijevanim vrijednostima, za ono što se ne vidi izvana."""
    monkeypatch.delenv("XAI_ROK", raising=False)
    monkeypatch.delenv("XAI_PAUZA", raising=False)
    specifikacija = importlib.util.spec_from_file_location("agent_za_test", SKRIPTA)
    modul = importlib.util.module_from_spec(specifikacija)
    monkeypatch.setitem(sys.modules, specifikacija.name, modul)
    specifikacija.loader.exec_module(modul)
    return modul


def test_svi_pokusaji_groka_staju_u_rok_workflowa(agent):
    # Workflow prekida posao poslije 25 minuta, a Worker čeka 30. Provjerava se strožiji rok.
    assert agent.ROK_GROKA == 480
    assert agent.POKUSAJI_GROKA == 2
    ukupno = agent.POKUSAJI_GROKA * agent.ROK_GROKA + agent.PAUZA_GROKA
    assert ukupno < 25 * 60


def test_uputstvo_trazi_detalj_koji_ne_ponavlja_kratak_opis(agent):
    # U probnom izvještaju je detalj kratke stavke bio ista rečenica kao kratak opis.
    assert "kažu više od kratkog opisa" in agent.UPUTSTVO_GROKU
    assert "nikad ista rečenica kao kratak_opis" in agent.UPUTSTVO_GROKU


def test_uputstvo_zabranjuje_napomene_i_zastarjelo_stanje_iz_pr_a(agent):
    # U probnom izvještaju je iz PR-a prepisano stanje koje je kasnije zastarjelo.
    assert "Stavka opisuje samo šta je urađeno" in agent.UPUTSTVO_GROKU
    for zabranjeno in ("napomene", "planove", "nije provjereno", "ne pokreći", "recenzenta"):
        assert zabranjeno in agent.UPUTSTVO_GROKU


def test_isteklo_vrijeme_pri_povezivanju_se_ne_vodi_kao_greska_mreze(agent, monkeypatch):
    # urllib grešku pri povezivanju umota u URLError, a grešku pri čekanju odgovora ne.
    def urlopen(*_, **__):
        raise urllib.error.URLError(TimeoutError("tekst koji ne smije u poruku"))

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)

    with pytest.raises(agent.Neuspjeh) as greska:
        agent.posalji(urllib.request.Request("http://example.invalid"), "Grok", 0, 1, 2)

    assert str(greska.value) == "Grok nije odgovorio ni poslije 2 pokušaja (isteklo vrijeme)."


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
        odgovor_groka([stavka(dokazi=[f"Izmišljen {POGODAK}"])]),
        odgovor_groka([stavka(dokazi=[7])]),
        odgovor_groka([{**stavka(), "dokazi": "D1"}]),
        odgovor_groka([{k: v for k, v in stavka().items() if k != "dokazi"}]),
        odgovor_groka([{**stavka(), "kratak_opis": "  "}]),
        odgovor_groka("nije spisak"),
        odgovor_sa_tekstom(f"nije json {POGODAK}"),
        odgovor_sa_tekstom(json.dumps({"stavke": [stavka()]}), status="incomplete"),
        {"status": "completed", "output": [{"type": "reasoning", "summary": []}]},
        {
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "refusal", "refusal": POGODAK}]}],
        },
    ],
    ids=[
        "prazan-spisak",
        "nepoznat-projekat",
        "neaktivan-projekat",
        "bez-polja",
        "nepoznat-dokaz",
        "dokaz-nije-tekst",
        "dokazi-nisu-spisak",
        "bez-dokaza",
        "prazan-opis",
        "stavke-nisu-spisak",
        "sadrzaj-nije-json",
        "nedovrsen-odgovor",
        "bez-poruke",
        "odbijanje",
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


def test_period_preko_prelaska_na_zimsko_vrijeme_pokriva_25_sati(repo, grok):
    # Sat se vraća 25.10.2026. u 03:00, pa 02:30 tog dana postoji dvaput.
    repo.izvjestaj("2026-10-24", AGENT, datetime.fromisoformat("2026-10-24T23:30+02:00"))
    repo.biljeska_u("2026-10-24T23:29+02:00", "Prije početka perioda.")
    repo.biljeska_u("2026-10-24T23:30+02:00", "Na početku perioda.")
    repo.biljeska_u("2026-10-25T02:30+02:00", "Prvi put 02:30.")
    repo.biljeska_u("2026-10-25T02:30+01:00", "Drugi put 02:30.")
    repo.biljeska_u("2026-10-25T23:29+01:00", "Prije kraja perioda.")
    repo.biljeska_u("2026-10-25T23:30+01:00", "Na kraju perioda.")
    okruzenje = {**repo.okruzenje(), "AGENT_SADA": "2026-10-25T22:30:40+00:00"}

    assert repo.pisi("2026-10-25", okruzenje=okruzenje)["ishod"] == "novi-fajl"

    period = repo.procitaj_izvjestaj("2026-10-25")["period"]
    assert period == {"od": "2026-10-24T23:30+02:00", "do": "2026-10-25T23:30+01:00"}
    trajanje = datetime.fromisoformat(period["do"]) - datetime.fromisoformat(period["od"])
    assert trajanje == timedelta(hours=25)
    assert [b["tekst"] for b in grok.biljeske()] == [
        "Na početku perioda.",
        "Prvi put 02:30.",
        "Drugi put 02:30.",
        "Prije kraja perioda.",
    ]


def test_bez_prethodnog_izvjestaja_preko_prelaska_su_24_stvarna_sata(repo, grok):
    # Na satu izgleda kao 23 sata, jer dan prelaska ima 25.
    repo.biljeska_u("2026-10-25T00:29+02:00", "Prije 24 sata i minut.")
    repo.biljeska_u("2026-10-25T00:30+02:00", "Prije tačno 24 sata.")
    okruzenje = {**repo.okruzenje(), "AGENT_SADA": "2026-10-25T22:30:40+00:00"}

    assert repo.pisi("2026-10-25", okruzenje=okruzenje)["ishod"] == "novi-fajl"

    period = repo.procitaj_izvjestaj("2026-10-25")["period"]
    assert period == {"od": "2026-10-25T00:30+02:00", "do": "2026-10-25T23:30+01:00"}
    assert [b["tekst"] for b in grok.biljeske()] == ["Prije tačno 24 sata."]


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


def test_github_ulazi_kao_ulaz_iz_repoa_aktivnih_projekata(repo, grok, github):
    github.issue(naslov="Issue iz perioda", tekst="Opis issue-a.")
    github.pr(naslov="Spojen PR", spojen=True, repo=DRUGI_REPO)
    github.pr(naslov="Otvoren PR")
    github.commit(poruka="Naslov commita\n\nTijelo commita.")
    github.issue(naslov="Neaktivan issue", repo=NEAKTIVAN_REPO)
    github.commit(poruka="Neaktivan commit", repo=NEAKTIVAN_REPO)

    izlaz = repo.pisi()

    assert izlaz["ishod"] == "novi-fajl"
    assert izlaz["upozorenja"] == []
    po_naslovu = {podatak["naslov"]: podatak for podatak in grok.github()}
    assert set(po_naslovu) == {"Issue iz perioda", "Spojen PR", "Otvoren PR", "Naslov commita"}
    assert po_naslovu["Issue iz perioda"]["vrsta"] == "Issue"
    assert po_naslovu["Issue iz perioda"]["tekst"] == "Opis issue-a."
    assert po_naslovu["Issue iz perioda"]["projekat"] == AKTIVAN
    assert po_naslovu["Spojen PR"]["vrsta"] == "PR"
    assert po_naslovu["Spojen PR"]["stanje"] == "merged"
    assert po_naslovu["Spojen PR"]["projekat"] == DRUGI_AKTIVAN
    assert po_naslovu["Otvoren PR"]["stanje"] == "open"
    assert po_naslovu["Naslov commita"]["vrsta"] == "Commit"
    assert po_naslovu["Naslov commita"]["tekst"] == "Tijelo commita."
    assert not any(NEAKTIVAN_REPO in adresa for adresa in github.trazeno)
    assert "Neaktivan" not in grok.poslato()


def test_github_se_samo_cita_i_uz_token_iz_okruzenja(repo, github):
    github.issue()
    github.commit()

    repo.pisi()

    assert set(github.metode) == {"GET"}
    assert set(github.tokeni) == {f"Bearer {TOKEN_GITHUBA}"}


def test_samo_rad_na_githubu_bez_biljeski_pravi_izvjestaj(repo, grok, github):
    github.commit()

    assert repo.pisi()["ishod"] == "novi-fajl"
    assert grok.biljeske() == []
    assert len(grok.github()) == 1


def test_groku_ide_samo_rad_iz_perioda(repo, grok, github):
    kraj = datetime.now(UTC).replace(second=0, microsecond=0) - timedelta(hours=3)
    repo.izvjestaj("2030-05-14", AGENT, kraj)
    prije_kraja = datetime.now(UTC) - kraj + timedelta(seconds=1)
    na_kraju = datetime.now(UTC) - kraj
    github.issue(prije_kraja, "Stari issue")
    github.commit(prije_kraja, "Stari commit")
    github.issue(timedelta(hours=1), "Issue iz perioda")
    github.commit(timedelta(hours=1), "Commit iz perioda")
    github.issue(timedelta(hours=-2), "Budući issue")
    github.commit(timedelta(hours=-2), "Budući commit")
    github.commit(na_kraju - timedelta(seconds=1), "Commit odmah poslije kraja")

    repo.pisi()

    assert sorted(podatak["naslov"] for podatak in grok.github()) == [
        "Commit iz perioda",
        "Commit odmah poslije kraja",
        "Issue iz perioda",
    ]


def test_commit_sa_svih_grana_ulazi_jednom(repo, grok, github):
    github.commit(poruka="Na obje grane")
    github.dodaj_na_granu("nova-grana", github.grane[REPO]["main"][0])
    github.commit(poruka="Samo na novoj grani", grana="nova-grana")

    repo.pisi()

    assert sorted(podatak["naslov"] for podatak in grok.github()) == [
        "Na obje grane",
        "Samo na novoj grani",
    ]
    assert len(grok.ulaz()["dokazi"]) == 2


def test_github_se_cita_po_stranicama(repo, grok, github):
    github.velicina_strane = 1
    for broj in range(3):
        github.issue(naslov=f"Issue {broj}")
        github.commit(poruka=f"Commit {broj}")

    repo.pisi()

    assert len(grok.github()) == 6


def test_link_na_drugu_adresu_ne_dobija_token(repo, grok, github):
    github.velicina_strane = 1
    github.issue()
    github.issue()
    github.link_umjesto_sljedece = "http://127.0.0.1:1/zli"

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())
    assert grok.zahtjevi == []


def test_dugacak_tekst_se_skracuje_a_pogodak_na_kraju_ga_ipak_izostavlja(repo, grok, github):
    github.issue(prije=timedelta(hours=3), naslov="Dugačak", tekst="a" * 5000)
    github.issue(naslov="Dugačak sa pogotkom", tekst="a" * 5000 + POGODAK)

    izlaz = repo.pisi()

    dugacak, sa_pogotkom = grok.github()
    assert len(dugacak["tekst"]) == 2000
    assert "tekst" not in sa_pogotkom
    assert len(izlaz["upozorenja"]) == 1


def test_issue_bez_opisa_ide_groku(repo, grok, github):
    github.issue(tekst=None)

    assert repo.pisi()["ishod"] == "novi-fajl"
    assert grok.github()[0]["tekst"] == ""


@pytest.mark.parametrize(
    "dodaj",
    [
        lambda github: github.issue(naslov=f"Naslov sa {POGODAK}"),
        lambda github: github.pr(naslov=f"Naslov sa {POGODAK}"),
        lambda github: github.commit(poruka=f"Naslov sa {POGODAK}"),
        lambda github: github.issue(naslov=f"Naslov sa {POGODAK}", tekst=f"Tekst sa {POGODAK}"),
    ],
    ids=["issue", "pr", "commit", "i-tekst"],
)
def test_podatak_sa_pogotkom_u_naslovu_ne_ide_groku_a_upozorenje_nema_vrijednost(
    repo, grok, github, dodaj
):
    github.issue(naslov="Dobar issue", prije=timedelta(hours=3))
    dodaj(github)

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    assert izlaz["ishod"] == "novi-fajl"
    assert [podatak["naslov"] for podatak in grok.github()] == ["Dobar issue"]
    assert POGODAK not in grok.poslato()
    assert len(izlaz["upozorenja"]) == 1
    assert izlaz["upozorenja"][0].startswith(f"{REPO} ")
    assert "zabranjen pojam" in izlaz["upozorenja"][0]
    assert POGODAK not in rezultat.stdout + rezultat.stderr


@pytest.mark.parametrize(
    "dodaj",
    [
        lambda github: github.issue(naslov="Pogođen", tekst=f"Tekst sa {POGODAK}"),
        lambda github: github.pr(naslov="Pogođen", tekst=f"Tekst sa {POGODAK}"),
        lambda github: github.commit(poruka=f"Pogođen\n\nTijelo sa {POGODAK}"),
    ],
    ids=["issue", "pr", "commit"],
)
def test_pogodak_u_tekstu_izostavlja_samo_tekst(repo, grok, github, dodaj):
    github.issue(prije=timedelta(hours=3), naslov="Stariji", tekst="Tekst starijeg.")
    dodaj(github)
    github.issue(prije=timedelta(hours=1), naslov="Noviji", tekst="Tekst novijeg.")

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    assert izlaz["ishod"] == "novi-fajl"
    assert POGODAK not in grok.poslato()
    stariji, pogodjen, noviji = grok.github()
    assert stariji["tekst"] == "Tekst starijeg."
    assert noviji["tekst"] == "Tekst novijeg."
    assert pogodjen["naslov"] == "Pogođen"
    assert "tekst" not in pogodjen
    assert pogodjen["dokaz"] == "D2"
    assert len(grok.ulaz()["dokazi"]) == 3
    assert len(izlaz["upozorenja"]) == 1
    assert izlaz["upozorenja"][0].startswith(f"{REPO} ")
    assert "tekst ima zabranjen pojam" in izlaz["upozorenja"][0]
    assert "izostavljen" in izlaz["upozorenja"][0]
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_podatak_sa_pogotkom_samo_u_tekstu_je_izvjestaj_a_ne_neuspjeh(repo, grok, github):
    github.issue(tekst=f"Tekst sa {POGODAK}")

    assert repo.pisi()["ishod"] == "novi-fajl"
    assert len(grok.github()) == 1


def test_pogodak_u_linku_izostavlja_samo_dokaz(repo, grok, github):
    github.issue(naslov="Sa pogotkom u linku", html_url=f"{DOZVOLJEN_LINK}repo/issues/{POGODAK}")

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    assert izlaz["ishod"] == "novi-fajl"
    assert grok.github()[0]["naslov"] == "Sa pogotkom u linku"
    assert grok.github()[0]["tekst"] == "Tekst."
    assert "dokaz" not in grok.github()[0]
    assert grok.ulaz()["dokazi"] == []
    assert POGODAK not in grok.poslato()
    assert "link ima zabranjen pojam" in izlaz["upozorenja"][0]
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_samo_podaci_sa_pogotkom_su_neuspjeh_a_ne_dan_bez_rada(repo, grok, github):
    github.issue(naslov=f"Naslov sa {POGODAK}")

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert grok.zahtjevi == []
    assert len(izlaz["upozorenja"]) == 1
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_pokvarena_provjera_podataka_je_neuspjeh(repo, grok, github):
    github.issue()
    repo.zapisi("napravi_sajt.py", POKVARENA_PROVJERA)

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())
    assert grok.zahtjevi == []


def test_provjera_podataka_koja_nije_o_jednom_podatku_je_neuspjeh(repo, grok, github):
    github.issue()
    repo.zapisi(
        "napravi_sajt.py",
        "import sys\nprint(f'{sys.argv[2]}: stavke[7].detalj fali', file=sys.stderr)\nsys.exit(1)\n",
    )

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())
    assert grok.zahtjevi == []


def test_provjera_podataka_ne_ostavlja_nista_u_repou(repo, github):
    github.issue(naslov=f"Naslov sa {POGODAK}")
    github.issue()

    repo.pisi()

    poziv = [p for p in repo.provjere() if p["zastavica"] == "--provjeri"][0]
    assert not Path(poziv["fajl"]).exists()
    assert not Path(poziv["fajl"]).resolve().is_relative_to(repo.putanja.resolve())


def test_grok_dobija_id_i_oznaku_a_python_upisuje_prave_linkove(repo, grok, github):
    broj_pr = github.pr()
    sha = github.commit(timedelta(hours=1))
    grok.vrati(odgovor_groka([stavka("Sa dokazima", dokazi=["D2", "D1", "D2"]), stavka("Bez dokaza")]))

    assert repo.pisi()["ishod"] == "novi-fajl"

    assert grok.ulaz()["dokazi"] == [
        {"id": "D1", "oznaka": f"PR #{broj_pr}"},
        {"id": "D2", "oznaka": f"Commit {sha[:7]}"},
    ]
    assert [podatak["dokaz"] for podatak in grok.github()] == ["D1", "D2"]
    assert "https://" not in grok.poslato()
    prva, druga = repo.procitaj_izvjestaj()["stavke"]
    assert prva["dokazi"] == [
        {"oznaka": f"Commit {sha[:7]}", "link": f"https://github.com/{REPO}/commit/{sha}"},
        {"oznaka": f"PR #{broj_pr}", "link": f"https://github.com/{REPO}/pull/{broj_pr}"},
    ]
    assert druga["dokazi"] == []


def test_link_koji_nije_dozvoljen_nije_dokaz_a_podatak_ide_groku(repo, grok, github):
    zli = "https://zli.example.com/repo/1"
    github.issue(prije=timedelta(hours=3), naslov="Sa lošim linkom", html_url=zli)
    github.issue(naslov="Sa dobrim linkom")

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    assert izlaz["ishod"] == "novi-fajl"
    los, dobar = grok.github()
    assert "dokaz" not in los
    assert dobar["dokaz"] == "D1"
    assert len(grok.ulaz()["dokazi"]) == 1
    assert zli not in grok.poslato()
    assert zli not in rezultat.stdout
    assert any("nije dokaz" in upozorenje for upozorenje in izlaz["upozorenja"])


def test_id_dokaza_sa_losim_linkom_je_neuspjeh(repo, grok, github):
    github.issue(html_url="https://zli.example.com/repo/1")
    grok.vrati(odgovor_groka([stavka(dokazi=["D1"])]))

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())


def test_nepoznat_id_dokaza_uz_poznat_je_neuspjeh_a_razlog_nema_vrijednost(repo, grok, github):
    github.issue()
    grok.vrati(odgovor_groka([stavka(dokazi=["D1", f"Izmišljen {POGODAK}"])]))

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert izlaz["razlog"] == "Grok je vratio dokaz koji nije na spisku."
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_bez_biljeski_i_bez_rada_na_githubu_je_dan_bez_rada_i_ne_treba_kljuc_groka(repo, grok, github):
    github.issue(naslov="Neaktivan", repo=NEAKTIVAN_REPO)
    github.issue(timedelta(hours=30), "Stari")
    okruzenje = repo.okruzenje()
    del okruzenje["XAI_API_KEY"]

    izlaz = repo.pisi(okruzenje=okruzenje)

    assert izlaz == {"ishod": "dan-bez-rada", "upozorenja": []}
    assert grok.zahtjevi == []


@pytest.mark.parametrize("sa_biljeskom", [False, True], ids=["bez-biljeske", "sa-biljeskom"])
@pytest.mark.parametrize(
    ("status", "putanja", "broj_pokusaja"),
    [(500, "/issues", 3), (503, "/branches", 3), (404, "/issues", 1), (403, "/commits", 1)],
    ids=["issues-500", "grane-503", "issues-404", "commitovi-403"],
)
def test_greska_githuba_je_neuspjeh_a_ne_dan_bez_rada(
    repo, grok, github, sa_biljeskom, status, putanja, broj_pokusaja
):
    if sa_biljeskom:
        repo.biljeska(timedelta(hours=2))
    github.commit()
    github.padni(status, putanja)

    izlaz = repo.pisi()

    tvrdi_neuspjeh_bez_fajla(repo, izlaz)
    assert grok.zahtjevi == []
    assert sum(putanja in adresa for adresa in github.trazeno) == broj_pokusaja
    assert "greska" not in izlaz["razlog"]
    assert f"status {status}" in izlaz["razlog"]


@pytest.mark.parametrize(
    ("putanja", "sadrzaj"),
    [
        ("/issues", b"nije json"),
        ("/issues", b'{"nije": "spisak"}'),
        ("/issues", json.dumps([{"title": "Bez polja"}]).encode()),
        ("/issues", json.dumps([{"updated_at": POGODAK}]).encode()),
        ("/branches", b"[7]"),
        ("/commits", b"[{}]"),
    ],
    ids=["nije-json", "nije-spisak", "bez-polja", "lose-vrijeme", "lose-grane", "los-commit"],
)
def test_neocekivan_odgovor_githuba_je_neuspjeh(repo, grok, github, putanja, sadrzaj):
    github.commit()
    github.pokvareno[putanja] = (200, sadrzaj)

    rezultat = repo.pokreni("pisi", "--datum", DATUM, "--repo", str(repo.putanja))

    tvrdi_neuspjeh_bez_fajla(repo, json.loads(rezultat.stdout))
    assert grok.zahtjevi == []
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_github_odgovori_iz_drugog_pokusaja(repo, github):
    github.issue()
    github.padni(503, "/issues", puta=1)

    assert repo.pisi()["ishod"] == "novi-fajl"


def test_github_ne_postoji_na_mrezi(repo):
    okruzenje = {**repo.okruzenje(), "AGENT_GITHUB_ADRESA": "http://127.0.0.1:1"}

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi(okruzenje=okruzenje))


def test_bez_tokena_githuba_je_neuspjeh_a_ne_dan_bez_rada(repo, grok):
    okruzenje = repo.okruzenje()
    del okruzenje["AGENT_GITHUB_TOKEN"]

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi(okruzenje=okruzenje))
    assert grok.zahtjevi == []


def test_aktivan_projekat_bez_repoa_je_neuspjeh(repo):
    repo.zapisi("projekti.json", json.dumps([{"ime": AKTIVAN, "aktivan": True}]))

    tvrdi_neuspjeh_bez_fajla(repo, repo.pisi())


def test_postojeci_fajl_ne_cita_github(repo, github):
    repo.izvjestaj(DATUM, AGENT)

    assert repo.pisi()["ishod"] == "postoji-fajl"
    assert github.trazeno == []


TUDJ_RAD = [
    lambda github: github.issue(user={"login": TUDJI_NALOG}),
    lambda github: github.issue(user={"login": BOT}),
    lambda github: github.issue(user=None),
    lambda github: github.pr(user={"login": TUDJI_NALOG}),
    lambda github: github.pr(user={"login": BOT}, spojen=True),
]
IMENA_TUDJEG_RADA = ["tudji-issue", "issue-bota", "issue-bez-autora", "tudji-pr", "pr-bota"]


@pytest.mark.parametrize("dodaj", TUDJ_RAD, ids=IMENA_TUDJEG_RADA)
def test_tudj_issue_i_pr_ne_ulaze_i_ne_prave_dan(repo, grok, github, dodaj):
    dodaj(github)

    assert repo.pisi() == {"ishod": "dan-bez-rada", "upozorenja": []}
    assert grok.zahtjevi == []


@pytest.mark.parametrize("dodaj", TUDJ_RAD, ids=IMENA_TUDJEG_RADA)
def test_svjez_rad_ne_broji_tudj_issue_i_pr(repo, github, dodaj):
    dodaj(github)

    assert repo.svjez_rad() == {"ishod": "nema-svjezeg-rada", "upozorenja": []}


def test_tudj_rad_se_preskace_a_moj_ulazi(repo, grok, github):
    github.issue(naslov="Tuđ issue", user={"login": TUDJI_NALOG})
    github.commit(poruka="Commit bota", author={"login": BOT})
    github.issue(naslov="Moj issue")
    github.commit(poruka="Moj commit")

    assert repo.pisi()["upozorenja"] == []
    assert sorted(podatak["naslov"] for podatak in grok.github()) == ["Moj commit", "Moj issue"]
    assert "Tuđ" not in grok.poslato()
    assert "bota" not in grok.poslato()


NISU_RAD = {
    "tudji-commit": {"author": {"login": TUDJI_NALOG}},
    "commit-bota": {"author": {"login": BOT}},
    "commit-bez-naloga": {"author": None},
    "commit-agenta": {"autor": AGENT},
    "commit-agenta-sa-kodom": {"autor": AGENT, "fajlovi": ("izvjestaji/2030-05-15.json", "kod.py")},
    "samo-biljeske": {"fajlovi": ("biljeske-sesija/a.json", "biljeske-sesija/b.json")},
    "samo-pitanja-o-radu": {"fajlovi": ("pitanja-o-radu/a.json", "pitanja-o-radu/podesavanja.json")},
    "samo-signal-rada": {"fajlovi": ("signal-rada.json",)},
    "biljeske-pitanja-i-signal": {
        "fajlovi": ("biljeske-sesija/a.json", "pitanja-o-radu/a.json", "signal-rada.json")
    },
}
JESU_RAD = {
    "biljeska-i-kod": {"fajlovi": ("biljeske-sesija/a.json", "kod.py")},
    "pitanje-i-kod": {"fajlovi": ("pitanja-o-radu/a.json", "kod.py")},
    "signal-i-kod": {"fajlovi": ("signal-rada.json", "kod.py")},
    "slican-folder": {"fajlovi": ("biljeske-sesija-stare/a.json",)},
    "signal-u-folderu": {"fajlovi": ("docs/signal-rada.json",)},
    "prazan-commit": {"fajlovi": ()},
}


@pytest.mark.parametrize("commit", NISU_RAD.values(), ids=NISU_RAD.keys())
def test_commit_koji_nije_rad_ne_ulazi_i_ne_pravi_dan(repo, grok, github, commit):
    github.commit(**commit)

    izlaz = repo.pisi()

    assert izlaz == {"ishod": "dan-bez-rada", "upozorenja": []}
    assert grok.zahtjevi == []


@pytest.mark.parametrize("commit", JESU_RAD.values(), ids=JESU_RAD.keys())
def test_commit_koji_jeste_rad_ulazi(repo, grok, github, commit):
    github.commit(poruka="Pravi rad", **commit)

    assert repo.pisi()["ishod"] == "novi-fajl"
    assert [podatak["naslov"] for podatak in grok.github()] == ["Pravi rad"]


def test_preimenovanje_iz_biljeski_je_rad(repo, grok, github):
    sha = github.commit(poruka="Premješteno", fajlovi=("biljeske-sesija/a.json",))
    github.fajlovi[sha][0]["previous_filename"] = "docs/a.json"

    assert repo.pisi()["ishod"] == "novi-fajl"


def test_fajlovi_commita_se_citaju_po_stranicama(repo, github):
    github.velicina_strane = 1
    github.commit(fajlovi=("biljeske-sesija/a.json", "kod.py"))

    assert repo.pisi()["ishod"] == "novi-fajl"


def test_biljeska_ulazi_i_kad_njen_commit_nije_rad(repo, grok, github):
    biljeska = repo.biljeska(timedelta(hours=2))
    github.commit(fajlovi=("biljeske-sesija/a.json",))

    assert repo.pisi()["ishod"] == "novi-fajl"
    assert [b["tekst"] for b in grok.biljeske()] == [biljeska]
    assert grok.github() == []


def test_svjez_rad_bez_ikakvog_rada(repo, github):
    assert repo.svjez_rad() == {"ishod": "nema-svjezeg-rada", "upozorenja": []}


def test_svjez_rad_je_posljednji_rad_i_ne_zove_groka_ni_provjeru(repo, grok, github):
    okruzenje = repo.okruzenje()
    del okruzenje["XAI_API_KEY"]
    github.issue(timedelta(hours=3))
    github.commit(timedelta(hours=1))
    repo.biljeska(timedelta(hours=2))

    izlaz = repo.svjez_rad(okruzenje)

    assert izlaz["ishod"] == "svjez-rad"
    ocekivano = datetime.now(UTC) - timedelta(hours=1)
    assert abs(datetime.fromisoformat(izlaz["vrijeme"]) - ocekivano) < timedelta(minutes=2)
    assert grok.zahtjevi == []
    assert repo.provjere() == []


def test_svjez_rad_iz_biljeske_kad_je_novija_od_githuba(repo, github):
    github.commit(timedelta(hours=3))
    trenutak = (datetime.now(UTC) - timedelta(minutes=10)).replace(second=0, microsecond=0)
    repo.biljeska_u(trenutak.isoformat(timespec="minutes"))

    assert datetime.fromisoformat(repo.svjez_rad()["vrijeme"]) == trenutak


def test_svjez_rad_iz_tekuceg_minuta_se_broji(repo, github):
    github.commit(timedelta(seconds=1))

    assert repo.svjez_rad()["ishod"] == "svjez-rad"


@pytest.mark.parametrize("commit", NISU_RAD.values(), ids=NISU_RAD.keys())
def test_svjez_rad_ne_broji_commit_koji_nije_rad(repo, github, commit):
    github.commit(**commit)

    assert repo.svjez_rad() == {"ishod": "nema-svjezeg-rada", "upozorenja": []}


@pytest.mark.parametrize("commit", JESU_RAD.values(), ids=JESU_RAD.keys())
def test_svjez_rad_broji_commit_koji_jeste_rad(repo, github, commit):
    github.commit(**commit)

    assert repo.svjez_rad()["ishod"] == "svjez-rad"


def test_svjez_rad_broji_biljesku_i_kad_njen_commit_nije_rad(repo, github):
    github.commit(fajlovi=("biljeske-sesija/a.json",))
    repo.biljeska(timedelta(hours=1))

    assert repo.svjez_rad()["ishod"] == "svjez-rad"


def test_svjez_rad_broji_biljesku_sa_pogotkom_a_vrijednost_ne_izlazi(repo, github):
    repo.biljeska(timedelta(hours=1), f"Bilješka sa {POGODAK}.")

    rezultat = repo.pokreni("svjez-rad", "--repo", str(repo.putanja))

    assert json.loads(rezultat.stdout)["ishod"] == "svjez-rad"
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_svjez_rad_ne_broji_neaktivne_projekte_ni_rad_prije_izvjestaja(repo, github):
    repo.izvjestaj("2030-05-14", AGENT, datetime.now(UTC) - timedelta(hours=2))
    github.commit(timedelta(hours=3))
    github.issue(timedelta(hours=3))
    repo.biljeska(timedelta(hours=3))
    repo.biljeska(timedelta(hours=1), "Privatan rad.", NEAKTIVAN)
    github.commit(timedelta(hours=1), repo=NEAKTIVAN_REPO)

    assert repo.svjez_rad() == {"ishod": "nema-svjezeg-rada", "upozorenja": []}


def test_signal_rada_je_svjez_rad_po_vremenu_commita_a_ne_fajla(repo, github):
    github.commit(timedelta(hours=2))
    # Vrijeme u fajlu je u periodu i kasnije od svega ostalog, pa bi pobijedilo da se čita.
    u_fajlu = datetime.now(UTC) - timedelta(minutes=5)
    trenutak = repo.signal(timedelta(minutes=50), u_fajlu=u_fajlu)

    izlaz = repo.svjez_rad()

    assert izlaz["ishod"] == "svjez-rad"
    assert datetime.fromisoformat(izlaz["vrijeme"]) == trenutak.replace(second=0)


def test_signal_iz_buducnosti_po_fajlu_se_racuna_po_commitu(repo, github):
    trenutak = repo.signal(timedelta(minutes=10))

    assert datetime.fromisoformat(repo.svjez_rad()["vrijeme"]) == trenutak.replace(second=0)


def test_svjez_rad_noviji_od_signala_je_posljednji_rad(repo, github):
    repo.signal(timedelta(minutes=50), u_fajlu=datetime.now(UTC))
    github.commit(timedelta(minutes=5))

    izlaz = repo.svjez_rad()

    ocekivano = datetime.now(UTC) - timedelta(minutes=5)
    assert abs(datetime.fromisoformat(izlaz["vrijeme"]) - ocekivano) < timedelta(minutes=2)


def test_posljednji_signal_se_racuna_a_ne_prvi(repo, github):
    repo.signal(timedelta(minutes=50))
    trenutak = repo.signal(timedelta(minutes=20))

    assert datetime.fromisoformat(repo.svjez_rad()["vrijeme"]) == trenutak.replace(second=0)


def test_signal_prije_prethodnog_izvjestaja_nije_svjez_rad(repo, github):
    repo.signal(timedelta(hours=3))
    repo.izvjestaj("2030-05-14", AGENT, datetime.now(UTC) - timedelta(hours=2))

    assert repo.svjez_rad() == {"ishod": "nema-svjezeg-rada", "upozorenja": []}


def test_samo_signal_rada_je_dan_bez_rada(repo, grok, github):
    repo.signal(timedelta(minutes=10))

    assert repo.pisi() == {"ishod": "dan-bez-rada", "upozorenja": []}
    assert grok.zahtjevi == []


def test_signal_rada_ne_ulazi_u_pisanje(repo, grok, github):
    u_fajlu = datetime(2030, 5, 15, 21, 7, tzinfo=UTC)
    repo.signal(timedelta(minutes=10), u_fajlu=u_fajlu)
    biljeska = repo.biljeska(timedelta(hours=1))

    assert repo.pisi()["ishod"] == "novi-fajl"
    assert [b["tekst"] for b in grok.biljeske()] == [biljeska]
    assert grok.github() == []
    assert "claude.ai" not in grok.poslato()
    assert "2030-05-15T21:07" not in grok.poslato()


def test_svjez_rad_upozorava_na_neispravnu_biljesku_bez_vrijednosti(repo):
    repo.zapisi("biljeske-sesija/pokvarena.json", json.dumps({"projekat": 7, "tekst": POGODAK}))

    rezultat = repo.pokreni("svjez-rad", "--repo", str(repo.putanja))
    izlaz = json.loads(rezultat.stdout)

    assert izlaz["ishod"] == "nema-svjezeg-rada"
    assert izlaz["upozorenja"][0].startswith("biljeske-sesija/pokvarena.json: ")
    assert POGODAK not in rezultat.stdout + rezultat.stderr


def test_greska_githuba_u_svjezem_radu_je_neuspjeh(repo, github):
    repo.biljeska(timedelta(hours=1))
    github.padni(500, "/issues")

    assert repo.svjez_rad()["ishod"] == "neuspjeh"


def test_svjez_rad_bez_tokena_je_neuspjeh(repo):
    okruzenje = repo.okruzenje()
    del okruzenje["AGENT_GITHUB_TOKEN"]

    assert repo.svjez_rad(okruzenje)["ishod"] == "neuspjeh"


def test_svjez_rad_na_plitkoj_kopiji_je_neuspjeh(repo, tmp_path):
    repo.izvjestaj("2030-05-14", AGENT)
    kopija = tmp_path / "plitka-kopija"
    subprocess.run(
        ["git", "clone", "-q", "--depth", "1", repo.putanja.as_uri(), str(kopija)], check=True
    )
    repo.putanja = kopija

    assert repo.svjez_rad()["ishod"] == "neuspjeh"


# Komanda odgovor: pitanja o radu (ADR 0007).


def odgovor_o_radu(
    tekst="Nemanja je juče radio na izvještajima.", izvjestaji=(), persiranje="bez_promjene"
) -> dict:
    return odgovor_sa_tekstom(
        json.dumps({"tekst": tekst, "izvjestaji": list(izvjestaji), "persiranje": persiranje})
    )


@pytest.fixture
def pitanja(grok):
    """Lažni Grok koji odgovara na pitanje o radu umjesto da piše stavke."""
    grok.vrati(odgovor_o_radu())
    return grok


def test_odgovor_se_cuva_sa_chatom_pitanjem_i_tekstom(repo, pitanja):
    prije = datetime.now(UTC).replace(microsecond=0)

    izlaz = repo.odgovor("Šta je radio juče?", chat="nemanja")

    assert izlaz["ishod"] == "odgovor"
    assert izlaz["tekst"] == "Nemanja je juče radio na izvještajima."
    assert izlaz["persiranje"] == "bez_promjene"
    [zapis] = repo.pitanja_o_radu()
    assert zapis["chat"] == "nemanja"
    assert zapis["pitanje"] == "Šta je radio juče?"
    assert zapis["odgovor"] == izlaz["tekst"]
    assert zapis["izvjestaji"] == []
    assert prije <= datetime.fromisoformat(zapis["vrijeme"]) <= datetime.now(UTC)
    assert izlaz["fajl"].startswith("pitanja-o-radu/")


def datum_prije(dana: int) -> str:
    return (datetime.now(ZoneInfo("Europe/Belgrade")) - timedelta(days=dana)).date().isoformat()


def tvrdi_bez_odgovora(repo: Repo, izlaz: dict, ishod: str) -> None:
    assert izlaz["ishod"] == ishod
    assert izlaz["tekst"] == ""
    assert izlaz["persiranje"] == "bez_promjene"
    assert repo.pitanja_o_radu() == []
    assert repo.podesavanja() is None


@pytest.mark.parametrize("vrijednost", [TAJNA, PUTANJA], ids=["tajna", "putanja"])
def test_pitanje_o_radu_sa_tajnom_ili_putanjom_je_odbijeno_bez_groka_i_fajla(
    repo, pitanja, github, vrijednost
):
    repo.biljeska(timedelta(hours=2))

    izlaz = repo.odgovor(f"Šta znači {vrijednost}?")

    tvrdi_bez_odgovora(repo, izlaz, "odbijeno")
    assert pitanja.zahtjevi == []
    assert github.trazeno == []
    assert izlaz["razlog"].startswith("Pitanje ima ")
    assert vrijednost not in repo.izlaz_odgovora


def test_pitanje_o_radu_sa_zabranjenim_pojmom_ide_groku(repo, pitanja):
    izlaz = repo.odgovor(f"Da li je radio na {POGODAK}?")

    assert izlaz["ishod"] == "odgovor"
    assert pitanja.ulaz()["pitanje"] == f"Da li je radio na {POGODAK}?"


def test_odgovor_sa_zabranjenim_pojmom_je_neuspjeh_bez_fajla(repo, pitanja):
    pitanja.vrati(odgovor_o_radu(f"Radio je na {POGODAK}.", persiranje="da"))

    izlaz = repo.odgovor()

    tvrdi_bez_odgovora(repo, izlaz, "neuspjeh")
    assert "zabranjen pojam" in izlaz["razlog"]
    assert POGODAK not in repo.izlaz_odgovora


def test_biljeska_sa_pogotkom_ne_ide_groku_za_odgovor_a_upozorenje_nema_vrijednost(repo, pitanja):
    dobra = repo.biljeska(timedelta(hours=2), "Dobra bilješka.")
    repo.biljeska(timedelta(hours=3), f"Bilješka sa {POGODAK}.")

    izlaz = repo.odgovor()

    assert izlaz["ishod"] == "odgovor"
    assert [b["tekst"] for b in pitanja.ulaz()["biljeske"]] == [dobra]
    assert POGODAK not in pitanja.poslato()
    assert len(izlaz["upozorenja"]) == 1
    assert "zabranjen pojam" in izlaz["upozorenja"][0]
    assert POGODAK not in repo.izlaz_odgovora


def test_podatak_sa_githuba_sa_pogotkom_ne_ide_groku_za_odgovor(repo, pitanja, github):
    github.issue(naslov=f"Issue sa {POGODAK}")
    github.issue(naslov="Dobar issue")

    izlaz = repo.odgovor()

    assert [p["naslov"] for p in pitanja.ulaz()["github"]] == ["Dobar issue"]
    assert POGODAK not in repo.izlaz_odgovora + pitanja.poslato()
    assert len(izlaz["upozorenja"]) == 1


def test_ulaz_za_odgovor_su_i_neaktivni_projekti_a_nepoznat_se_preskace(repo, pitanja, github):
    repo.biljeska(timedelta(days=10), "Rad na neaktivnom.", NEAKTIVAN)
    repo.biljeska(timedelta(hours=2), "Privatan rad.", "Nepoznat posao")
    github.issue(naslov="Issue neaktivnog", repo=NEAKTIVAN_REPO)

    izlaz = repo.odgovor()

    assert izlaz["upozorenja"] == []
    assert [b["tekst"] for b in pitanja.ulaz()["biljeske"]] == ["Rad na neaktivnom."]
    assert [(p["naslov"], p["projekat"]) for p in pitanja.ulaz()["github"]] == [
        ("Issue neaktivnog", NEAKTIVAN)
    ]
    assert "Privatan rad" not in pitanja.poslato()
    assert "dokaz" not in pitanja.ulaz()["github"][0]


def test_ulaz_za_odgovor_je_samo_posljednjih_30_dana(repo, pitanja, github):
    repo.biljeska(timedelta(days=29), "Skorašnja bilješka.")
    repo.biljeska(timedelta(days=31), "Stara bilješka.")
    github.issue(timedelta(days=29), naslov="Skorašnji issue")
    github.issue(timedelta(days=31), naslov="Stari issue")
    github.commit(timedelta(days=31), poruka="Stari commit")
    repo.izvjestaj(datum_prije(29), AGENT)
    repo.izvjestaj(datum_prije(31), AGENT)

    repo.odgovor()

    ulaz = pitanja.ulaz()
    assert [b["tekst"] for b in ulaz["biljeske"]] == ["Skorašnja bilješka."]
    assert [p["naslov"] for p in ulaz["github"]] == ["Skorašnji issue"]
    assert [i["datum"] for i in ulaz["izvjestaji"]] == [datum_prije(29)]
    stavke = ulaz["izvjestaji"][0]["stavke"]
    assert [s["kratak_opis"] for s in stavke] == ["Prva stvar", "Druga stvar"]
    assert "Stari" not in pitanja.poslato()


def test_pamcenje_je_5_posljednjih_pitanja_o_radu_sa_istog_chata_iz_24_sata(repo, pitanja):
    repo.zapisi_pitanje_o_radu(timedelta(hours=25), pitanje="Prestaro?")
    for sati in range(6, 0, -1):
        repo.zapisi_pitanje_o_radu(timedelta(hours=sati), pitanje=f"Pitanje prije {sati} h?")
    repo.zapisi_pitanje_o_radu(timedelta(minutes=30), "nemanja", "Pitanje sa drugog chata?")

    izlaz = repo.odgovor(chat="mentor")

    assert izlaz["upozorenja"] == []
    razgovor = pitanja.ulaz()["prethodni_razgovor"]
    assert [z["pitanje"] for z in razgovor] == [f"Pitanje prije {s} h?" for s in range(5, 0, -1)]
    assert razgovor[-1]["odgovor"] == "Raniji odgovor."
    assert "Prestaro" not in pitanja.poslato()
    assert "drugog chata" not in pitanja.poslato()


def test_pamcenje_mentora_nikad_ne_ide_nemanji(repo, pitanja):
    repo.zapisi_pitanje_o_radu(timedelta(minutes=30), "mentor", "Pitanje sa drugog chata?")

    repo.odgovor(chat="nemanja")

    assert pitanja.ulaz()["prethodni_razgovor"] == []
    assert "drugog chata" not in pitanja.poslato()


def test_uspjesan_odgovor_ulazi_u_pamcenje_sljedeceg_pitanja(repo, pitanja):
    repo.odgovor("Prvo pitanje?")
    repo.odgovor("A zašto?")

    [prethodni] = pitanja.ulaz()["prethodni_razgovor"]
    assert prethodni["pitanje"] == "Prvo pitanje?"
    assert prethodni["odgovor"] == "Nemanja je juče radio na izvještajima."
    assert len(repo.pitanja_o_radu()) == 2


def test_neuspio_odgovor_ne_ulazi_u_pamcenje(repo, pitanja):
    pitanja.vrati(odgovor_o_radu(f"Radio je na {POGODAK}."))
    repo.odgovor("Prvo pitanje?")
    pitanja.vrati(odgovor_o_radu())

    repo.odgovor("A zašto?")

    assert pitanja.ulaz()["prethodni_razgovor"] == []


def test_datum_izvjestaja_kog_nema_u_ulazu_je_neuspjeh(repo, pitanja):
    repo.izvjestaj(datum_prije(2), AGENT)
    pitanja.vrati(odgovor_o_radu(izvjestaji=[datum_prije(2), datum_prije(40)]))

    izlaz = repo.odgovor()

    tvrdi_bez_odgovora(repo, izlaz, "neuspjeh")
    assert izlaz["razlog"] == "Grok je vratio datum izvještaja koji nije u ulazu."


def test_link_na_izvjestaj_dodaje_python_iz_datuma(repo, pitanja):
    repo.izvjestaj(datum_prije(1), AGENT)
    repo.izvjestaj(datum_prije(3), AGENT)
    datumi = [datum_prije(1), datum_prije(3), datum_prije(1)]
    pitanja.vrati(odgovor_o_radu("Radio je dva dana.", izvjestaji=datumi))

    izlaz = repo.odgovor()

    assert izlaz["tekst"] == (
        "Radio je dva dana.\n\n"
        f"{ADRESA_SAJTA}/izvjestaji/{datum_prije(3)}/\n"
        f"{ADRESA_SAJTA}/izvjestaji/{datum_prije(1)}/"
    )
    [zapis] = repo.pitanja_o_radu()
    assert zapis["izvjestaji"] == [datum_prije(3), datum_prije(1)]
    assert zapis["odgovor"] == izlaz["tekst"]


@pytest.mark.parametrize("chat", ["mentor", "nemanja"])
def test_fajl_odgovora_nosi_ime_chata(repo, pitanja, chat):
    izlaz = repo.odgovor(chat=chat)

    assert izlaz["fajl"].endswith(f"-{chat}.json")
    assert repo.pitanja_o_radu()[0]["chat"] == chat
    assert pitanja.ulaz()["chat"] == chat


@pytest.mark.parametrize("chat", ["123456789", "grupa", ""])
def test_chat_koji_nije_mentor_ni_nemanja_je_neuspjeh(repo, pitanja, chat):
    izlaz = repo.odgovor(chat=chat)

    tvrdi_bez_odgovora(repo, izlaz, "neuspjeh")
    assert pitanja.zahtjevi == []


def test_persiranje_se_upisuje_za_da_i_ne_i_cuva_drugi_chat(repo, pitanja):
    pitanja.vrati(odgovor_o_radu(persiranje="da"))
    assert repo.odgovor("Persirajte mi, molim vas.", chat="mentor")["persiranje"] == "da"
    assert repo.podesavanja() == {"mentor": {"persiranje": True}}

    pitanja.vrati(odgovor_o_radu(persiranje="ne"))
    repo.odgovor("Može na ti.", chat="nemanja")
    oba = {"mentor": {"persiranje": True}, "nemanja": {"persiranje": False}}
    assert repo.podesavanja() == oba

    pitanja.vrati(odgovor_o_radu())
    repo.odgovor(chat="mentor")
    assert pitanja.ulaz()["obracanje"] == "vi"
    repo.odgovor(chat="nemanja")
    assert pitanja.ulaz()["obracanje"] == "ti"
    assert repo.podesavanja() == oba


def test_bez_promjene_ne_pravi_podesavanja(repo, pitanja):
    izlaz = repo.odgovor()

    assert izlaz["persiranje"] == "bez_promjene"
    assert pitanja.ulaz()["obracanje"] == "ti"
    assert repo.podesavanja() is None


def test_pokvarena_podesavanja_uz_promjenu_persiranja_su_neuspjeh_i_ostaju(repo, pitanja):
    repo.zapisi("pitanja-o-radu/podesavanja.json", f"nije json {POGODAK}")
    pitanja.vrati(odgovor_o_radu(persiranje="da"))

    izlaz = repo.odgovor()

    assert izlaz["ishod"] == "neuspjeh"
    assert repo.pitanja_o_radu() == []
    sadrzaj = (repo.putanja / "pitanja-o-radu/podesavanja.json").read_text(encoding="utf-8")
    assert sadrzaj == f"nije json {POGODAK}"
    assert POGODAK not in repo.izlaz_odgovora


def test_pokvarena_podesavanja_bez_promjene_su_odgovor_na_ti_uz_upozorenje(repo, pitanja):
    repo.zapisi("pitanja-o-radu/podesavanja.json", f"nije json {POGODAK}")

    izlaz = repo.odgovor()

    assert izlaz["ishod"] == "odgovor"
    assert pitanja.ulaz()["obracanje"] == "ti"
    assert izlaz["upozorenja"] == [
        "pitanja-o-radu/podesavanja.json: podešavanja nisu mogla da se pročitaju"
    ]
    assert POGODAK not in repo.izlaz_odgovora


def test_dugacak_odgovor_bez_nalaza_iz_adr_0002_prolazi(repo, pitanja):
    # Provjera bilješke ima i ograničenje dužine, a za odgovor se gledaju samo nalazi iz ADR 0002.
    pitanja.vrati(odgovor_o_radu("Radio je mnogo. " * 200))

    assert repo.odgovor()["ishod"] == "odgovor"


def test_zahtjev_za_odgovor_ima_model_semu_i_uputstvo(repo, pitanja, agent):
    repo.odgovor()

    zahtjev = pitanja.zahtjevi[0]
    assert zahtjev["model"] == "grok-4.7"
    assert zahtjev["store"] is False
    assert zahtjev["input"][0] == {"role": "system", "content": agent.UPUTSTVO_ZA_ODGOVOR}
    format_odgovora = zahtjev["text"]["format"]
    assert format_odgovora["strict"] is True
    sema = format_odgovora["schema"]
    assert set(sema["properties"]) == set(sema["required"]) == {"tekst", "izvjestaji", "persiranje"}
    assert sema["properties"]["persiranje"]["enum"] == ["da", "ne", "bez_promjene"]


@pytest.mark.parametrize(
    "sadrzaj",
    [
        "nije json",
        json.dumps({"tekst": "Tekst.", "izvjestaji": []}),
        json.dumps({"tekst": "Tekst.", "izvjestaji": [], "persiranje": "mozda"}),
        json.dumps({"tekst": "  ", "izvjestaji": [], "persiranje": "da"}),
        json.dumps({"tekst": "Tekst.", "izvjestaji": "2030-05-15", "persiranje": "da"}),
    ],
)
def test_los_odgovor_groka_na_pitanje_je_neuspjeh(repo, pitanja, sadrzaj):
    pitanja.vrati(odgovor_sa_tekstom(sadrzaj))

    tvrdi_bez_odgovora(repo, repo.odgovor(), "neuspjeh")


def test_nedovrsen_odgovor_groka_na_pitanje_je_neuspjeh(repo, pitanja):
    pitanja.vrati(odgovor_sa_tekstom(json.dumps({"tekst": "Tekst."}), status="incomplete"))

    tvrdi_bez_odgovora(repo, repo.odgovor(), "neuspjeh")


def test_grok_za_odgovor_ponavlja_brzu_gresku(repo, pitanja):
    pitanja.vrati_sirovo((503, b"greska"), (200, json.dumps(odgovor_o_radu()).encode()))

    assert repo.odgovor()["ishod"] == "odgovor"
    assert len(pitanja.zahtjevi) == 2


def test_ponovni_pokusaj_koji_ne_stane_u_rok_ne_ide(repo, pitanja):
    pitanja.kasnjenje = 1.0
    okruzenje = {**repo.okruzenje(), "XAI_ROK_ODGOVORA": "0.6", "AGENT_ROK_ODGOVORA": "1.0"}

    izlaz = repo.odgovor(okruzenje=okruzenje)

    tvrdi_bez_odgovora(repo, izlaz, "neuspjeh")
    assert len(pitanja.zahtjevi) == 1
    assert izlaz["razlog"] == (
        "Grok nije odgovorio (isteklo vrijeme), a ponovni pokušaj ne stane u rok."
    )


def test_rokovi_za_odgovor(agent):
    # Worker čeka 5 minuta od pokretanja, a jedan pokušaj Groka traje najviše 150 sekundi.
    assert agent.ROK_GROKA_ZA_ODGOVOR == 150
    assert agent.ROK_ODGOVORA == 300


def test_uputstvo_za_odgovor_nikad_ne_upucuje_na_nemanju(agent):
    uputstvo = agent.UPUTSTVO_ZA_ODGOVOR
    assert "nikad ne upućuj na Nemanju" in uputstvo
    assert '"pitaj Nemanju"' in uputstvo
    assert "o tome nema zapisa" in uputstvo
    assert "nikad ne tvrdi ništa netačno" in uputstvo
    assert "si tu da pričaš o tome šta je Nemanja uradio, pa se vrati na temu" in uputstvo
    assert "o Nemanji uvijek u trećem licu" in uputstvo
    assert "6-8 rečenica" in uputstvo


def test_odgovor_radi_na_plitkoj_kopiji(repo, pitanja, tmp_path):
    # Ulaz se bira po vremenu, a ne po istoriji, pa workflow-u treba samo plitka kopija.
    kopija = tmp_path / "plitka"
    subprocess.run(
        ["git", "clone", "-q", "--depth", "1", repo.putanja.as_uri(), str(kopija)], check=True
    )
    repo.putanja = kopija

    assert repo.odgovor()["ishod"] == "odgovor"
