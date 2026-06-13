# Zella Journal — reálná webová aplikace

Trading deník z prototypu, teď jako **plnohodnotná webová appka** s přihlášením a databází.
Stack: **Next.js (App Router) + PostgreSQL + Prisma + NextAuth**.

Celá logika i UI z prototypu je přenesená 1:1. Data se ukládají per uživatel do databáze
(přes jednoduché key-value úložiště), takže padá 5MB limit prohlížeče a každý má svoje data
za přihlášením.

---

## Co potřebuješ

- **Node.js 18.18+** (doporučeno 20+) — https://nodejs.org
- **PostgreSQL databázi**. Nejjednodušší zdarma online:
  - **Neon** — https://neon.tech (doporučuji, pár kliků)
  - **Supabase** — https://supabase.com
  - nebo lokální Postgres / Docker

---

## Spuštění lokálně (krok za krokem)

1. **Rozbal projekt** a otevři složku v terminálu.

2. **Nainstaluj závislosti:**
   ```bash
   npm install
   ```

3. **Vytvoř soubor `.env`** (zkopíruj `.env.example` a vyplň):
   ```bash
   cp .env.example .env
   ```
   - `DATABASE_URL` = connection string z Neon/Supabase/lokální DB
   - `NEXTAUTH_SECRET` = vygeneruj příkazem:
     ```bash
     openssl rand -base64 32
     ```
     (na Windows bez opensslu klidně vlož libovolný dlouhý náhodný řetězec)
   - `NEXTAUTH_URL` = nech `http://localhost:3000`

4. **Vytvoř tabulky v databázi:**
   ```bash
   npm run db:push
   ```
   (Prisma podle `prisma/schema.prisma` založí tabulky `User` a `Store`.)

5. **Spusť vývojový server:**
   ```bash
   npm run dev
   ```

6. Otevři **http://localhost:3000** → přesměruje tě na přihlášení.
   Klikni na **Zaregistruj se**, vytvoř účet a jsi v appce.

---

## Nasazení na Vercel (zdarma)

1. Nahraj projekt na GitHub.
2. Na https://vercel.com → **New Project** → vyber repozitář.
3. V **Environment Variables** přidej:
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` = adresa nasazené appky (např. `https://tvuj-projekt.vercel.app`)
4. **Deploy.** Po prvním nasazení jednou spusť migraci schématu do produkční DB:
   ```bash
   npx prisma db push
   ```
   (s produkčním `DATABASE_URL` v `.env`, nebo přes Vercel CLI).

---

## Jak je to poskládané

```
src/
  app/
    layout.jsx            kořenový layout + SessionProvider
    page.jsx              přesměrování podle přihlášení
    login/ register/      přihlášení a registrace
    app/page.jsx          chráněná stránka — ověří session, vykreslí deník
    api/
      auth/[...nextauth]/ NextAuth endpoint
      register/           založení účtu (hash hesla)
      store/              per-user key-value API (GET / POST set|delete)
  components/
    Journal.jsx           CELÝ deník z prototypu (jen storage míří na /api/store)
    JournalLoader.jsx     client loader + tlačítko Odhlásit
  lib/
    prisma.js   auth.js   databáze a konfigurace přihlášení
prisma/
  schema.prisma           model User + Store (key-value blob per uživatel)
```

### Datová vrstva
Prototyp ukládal data přes `store.get(key)` / `store.set(key, value)` jako JSON pod klíči
jako `tz:trades:v1`, `tz:accounts:v1` atd. V reálné appce ta samá volání míří na
`/api/store`, které čte/zapisuje do tabulky `Store` (scoped na přihlášeného uživatele).
Proto se nemusela přepisovat žádná logika — jen se vyměnil „šev" úložiště.

---

## Co dál (až budeme chtít)

- **Normalizace dat** do relačních tabulek (Trade, Playbook…) — teprve až bude potřeba
  dotazovat napříč uživateli (sdílení, mentor mode).
- **Sdílení / Mentor mode (Spaces)** — read-only přístup mentora.
- **Zella AI** — napojení na Anthropic API.
- **Externí integrace** — broker sync, tržní data pro Trade Replay/backtesting, Prop Firm Sync.
  (Tyhle potřebují placené externí služby a řeší se samostatně.)

Pokud něco při setupu hapruje, pošli mi přesnou chybovou hlášku z terminálu a doladíme to.
