"""Hook za bilješke sesija u Claude Code-u i komanda koja bilješku upisuje u privatni repo.

Komande:
  hook     poziva je Claude Code na svaku poruku i na kraj odgovora; poslije 30+ minuta
           rada u sesiji traži od Claude-a bilješku. Ne ide na mrežu i ne čita razgovor.
  upisi    poziva je Claude: `upisi "projekat"`, sa tekstom bilješke na stdin-u. Provjeri
           bilješku i pošalje je u main privatnog repoa.
  posalji  pokuša ponovo da pošalje bilješke koje čekaju.

Vidi hookovi/README.md.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

SKRIPTA = Path(__file__).resolve()
REPO = Path(os.environ.get("BILJESKE_REPO", SKRIPTA.parents[2] / "progress-report-izvjestaji"))
# Van svih repoa, jer stanje i neposlate bilješke ne smiju da završe u commitu.
FOLDER = Path(os.environ.get("BILJESKE_FOLDER", Path.home() / ".claude" / "biljeske-sesija"))
STANJE = FOLDER / "stanje"
NA_CEKANJU = FOLDER / "na-cekanju"
ODBIJENE = FOLDER / "odbijene"
BRAVA = FOLDER / "salje.lock"
GRESKA_SLANJA = FOLDER / "posljednja-greska-slanja.txt"

FOLDER_U_REPOU = "biljeske-sesija"
RAD_DO_BILJESKE = 30 * 60
# Duže od ovoga između dva odgovora je pauza, a ne rad.
PAUZA = 60 * 60
STANJE_VAZI = 30 * 24 * 60 * 60
ROK_BRAVE = 5 * 60
ROK_GITA = 60
POKUSAJI_PUSH = 3

PORUKA = "UserPromptSubmit"
KRAJ_ODGOVORA = "Stop"

PRAVILA = """\
Bilješka ostaje zauvijek u git istoriji, pa nikad ne smije da sadrži (ADR 0002):
- tajne i ključeve (tokeni, lozinke, sadržaj .env fajla);
- putanje sa Nemanjinog računara;
- privatne poruke;
- imena klijenata;
- interne materijale Tarikove firme.
Piši šta je urađeno i zašto, svojim riječima. Ne prepisuj razgovor."""


def ucitaj_stanje(putanja: Path) -> dict:
    try:
        return json.loads(putanja.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def obrisi_staro_stanje(sada: float) -> None:
    for putanja in STANJE.glob("*.json"):
        if sada - putanja.stat().st_mtime > STANJE_VAZI:
            putanja.unlink(missing_ok=True)


def aktivni_projekti() -> list[str]:
    try:
        projekti = json.loads((REPO / "projekti.json").read_text(encoding="utf-8"))
        return [projekat["ime"] for projekat in projekti if projekat.get("aktivan")]
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return []


def zahtjev_za_biljesku() -> str:
    projekti = aktivni_projekti()
    spisak = ", ".join(f'"{ime}"' for ime in projekti) if projekti else "(spisak nije dostupan)"
    return f"""\
Prošlo je 30+ minuta rada od posljednje bilješke sesije. Prije kraja napiši kratku bilješku o \
radu u ovoj sesiji od posljednje bilješke: 2 do 5 rečenica, najviše 2000 znakova, na našem \
jeziku (ijekavica). Ne nastavljaj zadatak koji je bio u toku.

{PRAVILA}

Projekat: ako je rad za aktivan projekat, upiši tačno njegovo ime: {spisak}. Ako nije, upiši \
kratak opšti naziv posla, bez imena klijenta. Takvu bilješku agent kasnije preskače.

Upiši bilješku Bash alatom, tačno ovako:
py -3 "{SKRIPTA.as_posix()}" upisi "IME PROJEKTA" <<'KRAJ'
Tekst bilješke, običan tekst.
KRAJ

Ako komanda javi grešku u provjeri, ispravi tekst i pokreni je još jednom. Ako ponovo ne uspije \
ili je alat odbijen, samo to javi u jednoj rečenici. Bilješku nemoj prepisivati u odgovor."""


def pokreni_slanje_u_pozadini() -> None:
    subprocess.Popen(
        [sys.executable, str(SKRIPTA), "posalji"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )


def hook() -> None:
    # Od ulaza se koriste samo ova polja. Razgovor, transcript_path i cwd se ne diraju (ADR 0005).
    ulaz = json.loads(sys.stdin.buffer.read())
    dogadjaj = ulaz["hook_event_name"]
    sesija = re.sub(r"[^A-Za-z0-9_-]", "_", ulaz["session_id"])

    sada = time.time()
    putanja = STANJE / f"{sesija}.json"
    stanje = ucitaj_stanje(putanja)
    rad = stanje.get("rad", 0)
    if "vrijeme" in stanje:
        proteklo = max(0, sada - stanje["vrijeme"])
        # Od poruke do kraja odgovora Claude radi, koliko god to trajalo.
        claude_radio = dogadjaj == KRAJ_ODGOVORA and stanje.get("dogadjaj") == PORUKA
        if claude_radio or proteklo < PAUZA:
            rad += proteklo

    # Vrijeme kreće ispočetka čim se bilješka zatraži, pa se ista ne traži dvaput zaredom.
    trazi = (
        dogadjaj == KRAJ_ODGOVORA
        and rad >= RAD_DO_BILJESKE
        and not ulaz.get("stop_hook_active")
        and ulaz.get("permission_mode") != "plan"
    )
    STANJE.mkdir(parents=True, exist_ok=True)
    putanja.write_text(
        json.dumps({"rad": 0 if trazi else rad, "vrijeme": sada, "dogadjaj": dogadjaj}),
        encoding="utf-8",
    )

    if dogadjaj == KRAJ_ODGOVORA and any(NA_CEKANJU.glob("*.json")):
        pokreni_slanje_u_pozadini()
    if trazi:
        obrisi_staro_stanje(sada)
        print(json.dumps({"decision": "block", "reason": zahtjev_za_biljesku()}))


def python_repoa() -> Path:
    for putanja in (REPO / ".venv/Scripts/python.exe", REPO / ".venv/bin/python"):
        if putanja.exists():
            return putanja
    return Path("nema-python-u-repou")


def provjeri(fajl: str, koren: Path) -> subprocess.CompletedProcess:
    """Isto pravilo kao pri pravljenju sajta. Spiskovi se čitaju iz foldera `koren`."""
    return subprocess.run(
        [str(python_repoa()), str(koren / "napravi_sajt.py"), "--provjeri-biljesku", fajl],
        cwd=koren,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=ROK_GITA,
    )


def git(*argumenti: str, koren: Path = REPO) -> None:
    subprocess.run(
        ["git", *argumenti],
        cwd=koren,
        check=True,
        capture_output=True,
        timeout=ROK_GITA,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )


def uzmi_bravu() -> bool:
    try:
        if time.time() - BRAVA.stat().st_mtime > ROK_BRAVE:
            BRAVA.unlink(missing_ok=True)
    except OSError:
        pass
    try:
        os.close(os.open(BRAVA, os.O_CREAT | os.O_EXCL))
        return True
    except OSError:
        return False


def slobodno_ime(folder: Path, ime: str) -> Path:
    putanja = folder / f"{ime}.json"
    broj = 2
    while putanja.exists():
        putanja = folder / f"{ime}-{broj}.json"
        broj += 1
    return putanja


def prebaci_u_kopiju(kopija: Path) -> list[Path]:
    """Prebaci bilješke koje čekaju u kopiju repoa. Vraća one koje su prošle provjeru."""
    prosle = []
    for fajl in sorted(NA_CEKANJU.glob("*.json")):
        odrediste = slobodno_ime(kopija / FOLDER_U_REPOU, fajl.stem)
        odrediste.parent.mkdir(exist_ok=True)
        shutil.copyfile(fajl, odrediste)
        rezultat = provjeri(odrediste.relative_to(kopija).as_posix(), kopija)
        if rezultat.returncode == 0:
            prosle.append(fajl)
        else:
            # Spiskovi su se promijenili poslije upisa: bez ove bilješke šaljemo ostale.
            odrediste.unlink()
            ODBIJENE.mkdir(parents=True, exist_ok=True)
            shutil.move(fajl, slobodno_ime(ODBIJENE, fajl.stem))
            print(f"Bilješka {fajl.name} nije prošla provjeru i ostaje u {ODBIJENE}.")
    return prosle


def posalji() -> bool:
    """Privremena kopija repoa, da se ne diraju izmjene i grana u Nemanjinom radnom folderu."""
    if not any(NA_CEKANJU.glob("*.json")):
        return True
    if not uzmi_bravu():
        return False
    kopija = Path(tempfile.mkdtemp(prefix="biljeska-"))
    dodana = False
    try:
        git("fetch", "origin", "main")
        git("worktree", "add", "--detach", str(kopija), "origin/main")
        dodana = True
        prosle = prebaci_u_kopiju(kopija)
        if not prosle:
            return True
        git("add", FOLDER_U_REPOU, koren=kopija)
        git("commit", "-m", "Bilješka sesije", koren=kopija)
        for pokusaj in range(POKUSAJI_PUSH):
            try:
                git("push", "origin", "HEAD:main", koren=kopija)
                break
            except subprocess.CalledProcessError:
                # U međuvremenu je stigao drugi commit.
                if pokusaj == POKUSAJI_PUSH - 1:
                    raise
                git("fetch", "origin", "main", koren=kopija)
                git("rebase", "origin/main", koren=kopija)
        for fajl in prosle:
            fajl.unlink()
        return True
    except (subprocess.SubprocessError, OSError) as greska:
        # Slanje u pozadini nema gdje da ispiše grešku, a bilješka bi inače čekala bez objašnjenja.
        detalj = getattr(greska, "stderr", None) or b""
        GRESKA_SLANJA.write_bytes(f"{datetime.now()}: {greska}\n".encode() + detalj)
        return False
    finally:
        if dodana:
            try:
                git("worktree", "remove", "--force", str(kopija))
            except (subprocess.SubprocessError, OSError):
                pass
        shutil.rmtree(kopija, ignore_errors=True)
        BRAVA.unlink(missing_ok=True)


def upisi(projekat: str) -> int:
    # Tekst nije JSON, jer Bash alat u Claude Code-u odbija vitičastu zagradu sa navodnicima.
    try:
        tekst = sys.stdin.buffer.read().decode("utf-8").strip()
    except ValueError:
        print("Tekst bilješke mora biti u UTF-8. Bilješka nije upisana.")
        return 1
    biljeska = {
        "vrijeme": datetime.now().astimezone().isoformat(timespec="minutes"),
        "projekat": projekat,
        "tekst": tekst,
    }

    NA_CEKANJU.mkdir(parents=True, exist_ok=True)
    # U imenu je samo vrijeme, jer ime fajla ostaje u git istoriji.
    fajl = slobodno_ime(NA_CEKANJU, datetime.now().strftime("%Y-%m-%dT%H%M%S"))
    nacrt = fajl.with_suffix(".nacrt")
    nacrt.write_text(json.dumps(biljeska, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    try:
        rezultat = provjeri(str(nacrt), REPO)
    except (subprocess.SubprocessError, OSError):
        nacrt.unlink()
        print("Provjera bilješke nije mogla da se pokrene. Bilješka nije upisana.")
        return 1
    if rezultat.returncode != 0:
        nacrt.unlink()
        # Provjera nikad ne ispisuje pronađenu vrijednost.
        print(rezultat.stderr.strip())
        return 1

    nacrt.rename(fajl)
    if posalji():
        print("Bilješka je upisana.")
    else:
        print("Bilješka je sačuvana i poslaće se kasnije. Rad može da se nastavi.")
    return 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    komanda = sys.argv[1] if len(sys.argv) > 1 else ""
    if komanda == "hook":
        # Greška hooka nikad ne smije da prekine rad u Claude Code-u.
        try:
            hook()
        except Exception:
            pass
        return 0
    if komanda == "upisi" and len(sys.argv) == 3:
        return upisi(sys.argv[2])
    if komanda == "posalji":
        return 0 if posalji() else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
