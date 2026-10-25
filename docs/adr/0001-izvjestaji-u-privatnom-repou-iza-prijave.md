# Izvještaji su u privatnom repou, a sajt je iza prijave

Izvještaje smiju da čitaju samo Nemanja i mentor Tarik. Zato izvještaji i sajt žive u posebnom **privatnom** repou, a sajt je zaštićen prijavom mejlom koja propušta tačno te dvije adrese (planirano: Cloudflare Pages + Cloudflare Access). Kod agenta ostaje u javnom repou `progress-report-agent`, jer je dio portfolija i u njemu nema ničeg povjerljivog.

## Razmotrene opcije

- **Javan sajt na GitHub Pages**: najjednostavnije, ali Tarik je tražio da izvještaje vidimo samo on i ja.
- **"Skrivena" adresa**: nije prava zaštita. Ko dobije link vidi sve, a javni repo otkriva sve adrese.
- **Sve u jednom privatnom repou**: radi, ali bi se izgubio javni kod za portfolio.

## Posljedice

- Izvještaj se nikad ne smije commit-ovati u javni repo, čak ni privremeno.
- Agent mora imati pristup za pisanje u privatni repo (token), i to samo u taj jedan repo.
