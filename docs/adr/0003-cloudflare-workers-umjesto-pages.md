# Sajt služi Cloudflare Workers, a pravi ga GitHub Actions

Stranice služi Cloudflare Workers, a ne Cloudflare Pages. Oba su besplatna, ali na Workers jedno podešavanje ("Protect this Worker behind Access", pa "All traffic") stavlja Cloudflare Access ispred **svih** adresa sajta, uključujući probne (preview) adrese. Na Pages ugrađeni prekidač štiti samo probne adrese, a glavna `pages.dev` adresa ostaje javna ako se ne urade dodatni ručni koraci. Kad je tajnost glavni zahtjev (vidi [0001](0001-izvjestaji-u-privatnom-repou-iza-prijave.md)), biramo zaštitu koja ne može da se podesi "napola".

Sajt ne pravi Cloudflare (Workers Builds), nego GitHub Actions u privatnom repou, koji ga zatim objavljuje preko `wrangler deploy`. Oznaka "ručno ispravljeno" se računa iz pune git istorije, a Cloudflare ne dokumentuje da li je pri pravljenju preuzima. GitHub Actions je preuzima sa `fetch-depth: 0`.

## Posljedice

- Adresa sajta je oblika `https://<ime>.<nalog>.workers.dev/izvjestaji/GGGG-MM-DD/`.
- Pri podešavanju Access-a mora se izabrati "All traffic". Opcija "Previews only" ostavlja glavnu adresu javnom. Preview adrese su uz to isključene (`"preview_urls": false`).
- Poslije svake objave automatska provjera potvrđuje da zahtjev bez prijave ne dobija stranicu.
- Cloudflare API token se ne može ograničiti na jedan Worker, nego samo na nalog. Zato na tom nalogu nema drugih Worker-a, a token je samo u GitHub Secrets privatnog repoa.
- Cloudflare Zero Trust traži podatke za plaćanje i na besplatnom planu (do 50 korisnika se ništa ne naplaćuje).
