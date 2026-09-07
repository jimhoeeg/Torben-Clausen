# Prisberegner & leadmodul – Torben Clausen A/S

Et selvstændigt, interaktivt prisestimat- og leadmodul i **ren HTML, CSS og JavaScript**.
Ingen frameworks, ingen build, ingen server. Modulet guider brugeren gennem fire trin,
giver løbende gratis "Ekspert-indsigter", låser resultatet op mod kontaktoplysninger og
genererer til sidst en 2-siders PDF-rapport i browseren.

| Fil | Indhold |
| --- | --- |
| `torben-clausen-lead-modul.html` | Hele modulet – markup, `<style>` og `<script>`. Det er denne fil, der kopieres ind i CMS'et. |
| `test/module.test.js` | Automatisk browsertest af flow, validering, indsigter, beregninger og PDF (Playwright). |

Filen kan åbnes direkte i en browser for at se modulet i drift.

---

## 1. Indsæt modulet på hjemmesiden

1. Åbn `torben-clausen-lead-modul.html` og kopiér **hele indholdet**.
2. Indsæt det i en "Custom HTML"-blok / kodeblok på den ønskede side.
3. Færdig. Modulet centrerer sig selv i indholdsbredden (maks. 880 px).

Al CSS er navnerumsbestemt under `.tcx`, og al JavaScript kører i en lukket funktion.
Modulet kan derfor ikke kollidere med temaets egen kode, og det kan indsættes flere
gange på samme site (dog kun ét modul pr. side – det bruger faste id'er).

Eneste eksterne afhængighed er **jsPDF**, som hentes fra CDN og kun bruges til
PDF-download. Kan biblioteket ikke hentes, fungerer resten af modulet uændret, og
brugeren får en pæn besked med telefonnummeret i stedet for en fejl.

---

## 2. Ret priserne

Alle satser ligger samlet ét sted – i objektet `P` øverst i `<script>`-blokken.
Ret tallene der, så følger både beregning, specifikation og PDF automatisk med:

```js
var P = {
  nedbrydning: {
    m2:    { villa: 475, erhverv: 395 },   // kr. pr. m² bygningsareal
    miljo: { risiko: 185, foer1950: 95, nyere: 35 },
    fundament: 140,                        // kr. pr. m² for sokkel/terrændæk
    etablering: 12500,
    min: 25000
  },
  ...
};
```

Alle beløb er **ekskl. moms**. Fragtzonerne styres af `zoneFor()`, der oversætter
postnummer til zone A–D.

### Beregningsmodellen kort fortalt

| Område | Grundpris | Væsentligste variabler |
| --- | --- | --- |
| Nedbrydning | m² × sats (villa/erhverv) | Byggeår → miljøsanering (1950–1990 udløser den høje sats), fundament, fast etablering |
| Anlægsarbejde | lbm × 1.450 (kloak) / m³ × 285 (jord) | Jordtype (sand/ler/fyld/forurenet), +18 % ved trange adgangsforhold |
| Transport | tons × materialesats | Bigbags (+275 kr./ton) vs. løs levering, antal læs × fragtzone |
| Affald | tons × fraktionssats | +20 % usorteret / −12 % kildesorteret, container pr. 8 tons |

Resultatet vises som et interval på **±15 %**, afrundet til nærmeste 500 kr.
Hver post vises med sin egen delberegning ("140 m² × 475 kr./m²"), så estimatet
er gennemskueligt for kunden.

---

## 3. Få leads ud af modulet

Når kunden låser sit resultat op, sker der tre ting:

1. Leadet logges i browserkonsollen (praktisk under test).
2. Der udsendes et DOM-event, som jeres eget script kan lytte på:

```js
document.addEventListener('tc:lead', function (e) {
  console.log(e.detail);   // { omraade, omraadeId, svar, estimat, lead, kilde }
});
```

3. Er der sat et endpoint, POST'es leadet som JSON dertil. Definér det **før**
   modulet på siden – f.eks. et Zapier/n8n-webhook eller jeres eget CRM:

```html
<script>window.TC_LEAD_ENDPOINT = 'https://…/webhook/leads';</script>
```

Payload:

```json
{
  "omraade": "Nedbrydning & Miljøsanering",
  "omraadeId": "nedbrydning",
  "svar": [["Område","Nedbrydning & Miljøsanering"], ["Hvor stort er bygningsarealet","140 m²"]],
  "estimat": { "min": 106000, "max": 143000, "midt": 124500, "valuta": "DKK", "momsfri": true },
  "lead": { "navn": "Jens Pedersen", "email": "jens@…", "telefon": "20 30 40 50", "samtykke": true, "tidspunkt": "…" },
  "kilde": "https://www.torbenclausen.dk/…"
}
```

**GDPR:** Modulet kræver aktivt samtykke, før kontaktoplysninger gemmes, og linker til
persondatapolitikken. Ret linket i markup'en (`/politik-om-beskyttelse-af-persondata`),
hvis stien er en anden. Der er desuden et skjult honeypot-felt, som frasorterer bots.

---

## 4. PDF-rapporten

To sider, genereret 100 % i browseren – ingen data forlader kundens maskine:

* **Side 1 – "Din Projekt-Rapport":** rødt brevhoved, rekvirent, sagsnummer, kundens
  svar, prisboksen med intervallet og en fuld specifikation af estimatet.
* **Side 2 – "Din Personlige Projekt-Guide":** tre konkrete råd, der vælges ud fra
  kundens egne svar (f.eks. asbest ved byggeår 1950–1990, jordbalance ved lerjord,
  løs levering frem for bigbags over 5 tons), samt en opfordring til at ringe på 74 52 47 23.

Filnavnet indeholder kundens navn: `torben-clausen-projektrapport-jens-pedersen.pdf`.

---

## 5. Design

Farver og radius styres af CSS-variabler på `.tcx` – ret dem ét sted:

```css
--tc-red:#C42032;        /* knapper, valgte kort, prisen, venstrekant på indsigter */
--tc-red-deep:#7E1620;   /* bundfelt */
--tc-ink:#242424;
```

Typografien er Arial/Helvetica som på det øvrige site. Layoutet er bygget med
flexbox og grid og er testet fra 390 px op til desktop. `prefers-reduced-motion`
respekteres.

---

## 6. Kør testene

```bash
npm install playwright jspdf
npx playwright install chromium
node test/module.test.js
```

Har du allerede en Chromium liggende, kan den bruges direkte:
`CHROME_PATH=/sti/til/chrome node test/module.test.js`

Testen dækker alle fire områder: trinnavigation, feltvalidering, at de rigtige
ekspert-indsigter dukker op og forsvinder igen, at beregningerne rammer de
forventede beløb, at leadgaten ikke kan omgås, honeypot, `tc:lead`-eventet samt at
PDF'en faktisk genereres med to sider.

Bemærk: testen indlæser jsPDF lokalt (`jspdf.umd.min.js` ved siden af testsiden),
så den kan køre uden netadgang til CDN'et.
