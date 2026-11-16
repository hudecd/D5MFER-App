# D5MFER · Náš sklad

Súkromná mobilná PWA pre Damiana a Fera. Bielo-ružový vzhľad, sklad po kusoch,
predaje so skutočnou prijatou sumou, príjmy s platiteľom, fotografie, história,
storná, opravy inventúry, prevody medzi partnermi a export JSON/CSV.

Pri prvom spustení možno doplniť staršie nákupy a predaje cez Prehľad alebo
Účty → Staršie nákupy a predaje. Formulár podporuje nákup aj predaj naraz,
iba nákup alebo iba predaj. Zadáva sa názov (bez nutnosti produktu v katalógu
či fotografie), skutočné dátumy, počty kusov, náklady vrátane dopravy a poplatkov,
platiteľ a osoba, ktorá prijala tržbu. Pri páre môžu byť kúpené a predané počty
rôzne; predaný počet nesmie prekročiť kúpený. Zvyšné dnešné kusy sa nastavujú
samostatne cez počiatočný sklad.

Príkaz `historical` uloží `historical_purchase` a/alebo `historical_sale` s
príznakom `affectsStock: false`. Celý pár sa overí pred uložením; retry s rovnakým
ID nič neduplikuje. Účty zahŕňajú tieto náklady a príjmy, vrátane ich stornovania.
Aktuálne produkty, množstvá, nákupné ceny na sklade aj verejná ponuka sa nemenia.
Záznamy sú označené ako spätne doplnené a sú súčasťou exportu; storno každého
staršieho pohybu upraví len príslušnú platbu, bez vrátenia tovaru do skladu.

Príjem sa pýta osobitne na doručené kusy a kusy určené do ponuky. Celý fyzický
počet sa uloží do `stock`; zverejnené množstvo do `listedStock`. Zvyšok zostáva
v sklade mimo ponuky a dá sa neskôr uvoľniť cez úpravu produktu. Existujúce dáta
bez `listedStock` si zachovávajú pôvodný význam: všetky skladové kusy sú v ponuke.
Cena tovaru, poštovné a ostatné poplatky sú uložené oddelene v príjme. Ich súčet
sa odpočíta od účtu platiteľa; náklad na kus sa počíta zo všetkých doručených
kusov vrátane tých mimo ponuky.

Príjem celého balíka začína otázkou na počet druhov tovaru (1 až 50).
Každý druh sa zadá samostatne ako nový alebo existujúci produkt, s fotkou,
cenou samotného tovaru, doručeným počtom a počtom kusov do ponuky. Až po
poslednom druhu sa zadá poštovné, ostatné poplatky a spoločný platiteľ.
Zadané druhy možno pred potvrdením upraviť alebo pridať ďalší.

Spoločné poštovné a poplatky sa rozpočítajú úmerne podľa počtu všetkých
doručených kusov. Rovnaký počet kusov dostane rovnaký podiel bez ohľadu na
cenu produktu. Zaokrúhľuje sa každá zložka osobitne na celé centy, zvyšné centy
sa rozdelia podľa najväčších zvyškov (pri zhode podľa poradia položiek).
Súčet podielov sa presne rovná zadanému poštovnému a poplatkom.

Klient aj server používajú rovnaký výpočet v `public/shipment-costs.js`.
Príkaz `shipment` sa overí na kópii aktuálneho stavu a všetky položky sa
uložia jediným podmieneným zápisom. Chyba posledného druhu tak neuloží ani
predchádzajúce druhy. Každý príjem v denníku má `shipmentId`, poradie položky
a vlastný podiel nákladov. Hlavička v `shipments` je iba prehľad; finančné
súčty vychádzajú z príjmov, takže poštovné sa nezapočíta druhýkrát.
Opakované odoslanie toho istého balíka používa rovnaké ID a nemení sklad ani účty.
Rozpracovaný balík sa drží v pamäti otvorenej stránky; do skladu a účtov sa
zapíše až po konečnom potvrdení. Fotografie sa počas prípravy ukladajú súkromne.

Po nahratí fotografie sa automaticky vyžiada návrh názvu, kategórie, farby a
popisu. Pred uložením ho možno upraviť; pri existujúcom produkte je tlačidlo na
nový návrh. Server používa Vercel AI Gateway a SDK `ai`, s existujúcim OIDC
Vercel runtime alebo s explicitne nastaveným `AI_GATEWAY_API_KEY`. Model možno
zmeniť cez `AI_GATEWAY_MODEL` (predvolený `openai/gpt-5.4-mini`, overený v živom
zozname modelov). Žiadny poskytovateľský kľúč nepatrí do klienta. Generovanie
vyžaduje prihlásenie a je limitované na 12 pokusov za 15 minút na osobu.
AI iba navrhuje text, nemení sklad ani produkt. Neodhadujú sa materiál,
veľkosť, stav ani pravosť; označenie repliky a referenčnej fotografie sa
dopĺňa podľa údajov majiteľov. Výpadok AI nevymaže vyplnený formulár.

## Nasadenie

- GitHub: `hudecd/D5MFER-App`, produkčná vetva `main`.
- Vercel: `d5mfer-app`, tím `d5-mfer`, Node.js 24, výstup `public/`.
- Git integrácia nasadzuje každý push; GitHub Actions overuje kód a testy.
- Appka: https://d5mfer-app-d5-mfer.vercel.app
- Testovací katalóg: https://d5mfer-app-d5-mfer.vercel.app/katalog.html

Aktuálne je nasadený **testovací režim**. Pôvodný web `d5mfer.vercel.app` sa
nemení. Testovacie transakcie sú trvalo uložené v súkromnom úložisku, nie iba
v prehliadači. Po používateľskom testovaní je potrebný výslovný reset a prechod
na ostrú prevádzku. Zmena APP_MODE sama osebe nepripojí pôvodný web.

## Prvé otvorenie

Vlastník dostane jednorazový aktivačný odkaz s tokenom vo fragmente URL.
Token nie je súčasťou repozitára a pri otvorení sa odstráni z adresného riadka.
Nastavia sa heslá pre oboch používateľov (minimálne 12 znakov).
Po aktivácii už endpoint odmietne ďalšie nastavenie.

Päť produktov je importovaných zo živého katalógu. Počet kusov je `null`,
pretože existujúci web množstvá neeviduje. Každý produkt vyžaduje počiatočný
stav; neodhadujeme, že ide o jeden kus. Počiatočné stavy nevytvárajú historické
platby. Staršie vklady a náklady treba pri ostrom štarte odsúhlasiť osobitne.

## Dáta a súbežnosť

Pre túto malú dvojpoužívateľskú appku sa používa súkromný Vercel Blob ako
spoločné dokumentové úložisko. `private/d5mfer-ledger-v1.json` obsahuje produkty,
denník pohybov, účty používateľov (solené scrypt hash hodnoty hesiel), ID operácií
a referencie fotografií. Nejde o SQL databázu. Celý pohyb skladu a peňazí sa
ukladá jedným podmieneným zápisom s ETag; pri konflikte sa načíta nový stav a
operácia sa overí znova. Ochrana proti opakovanému odoslaniu používa ID aj hash
obsahu operácie. Originálne ETag úvodzovky sa zachovávajú, HTTP `W/` prefix sa
odstraňuje pred podmieneným zápisom.

Fotografie sú v tom istom súkromnom úložisku. Bez prihlásenia sa dajú načítať
iba tie, ktoré sú priradené k aktuálne dostupnému a publikovanému produktu.
Verejný endpoint katalógu vracia len produktové údaje, nikdy nákupné náklady,
presné množstvá, účty ani používateľské údaje. Súkromné API používa `no-store`.
Service worker uchováva len statický obal appky; offline zápisy sú zakázané.

Toto riešenie je vhodné pre malý sklad s nízkou frekvenciou zápisov. Pri veľkom
objeme denníka alebo viacerých skladoch je vhodná migrácia na relačnú databázu.
Zálohy údajov si stiahnete v záložke Účty. Nie je nakonfigurovaná nezávislá
automatická archivácia starších verzií dát.

## Výpočty

Suma sa všade počíta v celých centoch. Osobný peňažný tok je:
prijaté predaje − zaplatené nákupy + prijaté prevody − odoslané prevody.
Nie je to zisk ani automatický výpočet dlhu partnera. Appka neposiela peniaze.
Nákupné náklady príjmu zahŕňajú používateľom zadanú dopravu. Pri spoločnej
platbe sa zadávajú dva príjmy. Storno predaja vráti kusy aj príjem; storno príjmu
je povolené iba bez neskorších skladových pohybov daného produktu.

## Lokálny vývoj a overenie

```sh
npm ci
# Doplňte .env.local podľa .env.example, necommitujte ho.
npm run check
npm test
npm run dev
```

Potrebné premenné: `BLOB_READ_WRITE_TOKEN`, `SESSION_SECRET`, `BOOTSTRAP_TOKEN`,
`APP_MODE=test`. Úložisko musí byť súkromné. Ak prostredie používa HTTP proxy,
pre lokálny Node.js nastavte `NODE_USE_ENV_PROXY=1`.

Testy zahŕňajú skladové a finančné pravidlá, heslá a relácie a DOM priechod
prihlásenie → počiatočný stav → predaj → história → účty. Test DOM nie je
vizuálny test v Safari. Integračný skript overuje API a skutočné úložisko vrátane
súbežného predaja posledného kusu. Spúšťajte ho **iba na prázdnej testovacej
inštalácii** s `ALLOW_TEST_RESET=yes`; dočasné QA dáta po sebe vymaže.

## Prechod na ostrú prevádzku

1. Vlastníci dokončia testovanie a výslovne požiadajú o reset.
2. Zálohovať testovacie údaje, resetovať testovacie finančné pohyby, sklad,
   fotografie a prístupy podľa dohodnutého rozsahu; vytvoriť nový aktivačný token.
3. Zadať skutočné počiatočné množstvá a dohodnúť, ako sa evidujú staršie platby.
4. Nastaviť APP_MODE=live a aktualizovať texty testovacieho katalógu/odkazov.
5. Na existujúcom projekte `d5mfer` nastaviť a overiť presné presmerovanie dát
   `/catalog.json` na `https://d5mfer-app-d5-mfer.vercel.app/api/index?action=catalog`
   (project-level rewrite, nie HTTP redirect). Zachovať existujúce routy a cache
   `no-store`. Toto prepojenie zatiaľ **nie je zapnuté**.
6. Overiť posledný kus, nový produkt, fotky, galériu a počty na pôvodnom webe.

Nenasadzovať nekompletnú zálohu pôvodného webu: obsahuje samostatný serverový
formulár, ktorý treba zachovať. Jeho zdroj ani tajomstvá nepatria do tohto
verejného repozitára. Projekt `d5mfer-app-storage` drží pripojenie k súkromnému
úložisku; aktívny Git projekt `d5mfer-app` používa rovnaké poverenie uložené vo
Vercel environment variables. Žiadne tajomstvá sa neukladajú do GitHubu.
