import { bewaarIngredient, laad, wijzig } from "../store.js";
import { gram } from "../voeding.js";
import { aansnijdbaar, BIJNA_OP, bewaren, bijnaOp, eersteOptie, gauwOp, geschatGebruikt, ingVan, minimumVan, openen, opTegen, perStuk,
  PLEKKEN, rond, soortVan, standaardPlek, toonPartij, toonPartijen, verpakkingOpties, voorraadEenheden } from "../planning.js";
import { dagenTot, datumNl, esc, houdbaar, melding, nieuwId, vandaag } from "../util.js";
import { aantalPorties, koppelPorties, oudePorties, portiesHtml } from "./porties.js";

const f = { zoek: "" };
const fout = (err) => melding(err.message);
const PLEKNAAM = Object.fromEntries(PLEKKEN);

// Ingrediënten waarvan de naam met de tekst begint ("melk" → "Melk (halfvol)", niet "Kokosmelk").
function kandidaten(data, t) {
  return Object.keys(data.ingredienten).filter((s) => data.ingredienten[s].naam.toLowerCase().startsWith(t));
}

// Zoek een ingrediënt op naam (zoals gekozen uit de lijst), op code, of op het begin van de
// naam als dat er maar één oplevert.
export function vindIngredient(data, tekst) {
  const t = tekst.trim().toLowerCase();
  if (!t) return null;
  if (data.ingredienten[t]) return t;
  const exact = Object.keys(data.ingredienten).find((s) => data.ingredienten[s].naam.toLowerCase() === t);
  if (exact) return exact;
  const k = kandidaten(data, t);
  return k.length === 1 ? k[0] : null;
}

export function ingredientKeuzelijst(data, id) {
  const namen = Object.values(data.ingredienten).map((i) => i.naam).sort((a, b) => a.localeCompare(b, "nl"));
  return `<datalist id="${id}">${namen.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
}

// Badge met hoe lang iets nog goed is. Lang houdbare dingen (rijst, blikken) krijgen er geen.
function opBadge(p, data) {
  const datum = opTegen(p, data);
  if (!datum) return "";
  const n = dagenTot(datum);
  if (n > 14) return "";
  const tekst = n < 0 ? "over de datum" : n === 0 ? "vandaag op" : n === 1 ? "morgen op" : `nog ${n} dagen`;
  return `<span class="badge${n <= 3 ? " waarsch" : ""}" title="Op voor ${esc(datumNl(datum))}${p.tht ? " (tht)" : " (bewaaradvies)"}">${tekst}</span>`;
}

// "in huis", met een schatting hoeveel er nog is als je er al mee gekookt hebt. "bijna op?"
// volgt dezelfde regel als de boodschappenlijst (kruiden hooguit eens per maand).
function inHuisTekst(p, data) {
  const g = geschatGebruikt(p, data);
  const titel = "Geschat uit wat je sinds het kopen gekookt hebt";
  if (bijnaOp([p], data) != null) return `<span class="badge waarsch" title="${titel}">bijna op?</span>`;
  if (g == null || g < 0.1 || g >= BIJNA_OP) return `<small>in huis</small>`;
  return `<small title="${titel}">in huis · nog ±${Math.max(0, 100 - Math.round(g * 10) * 10)}%</small>`;
}

// De partijen van één soort (alle varianten) vóór een actie, en een functie die ze terugzet (voor
// "Ongedaan maken"). Met `logId` gaat ook die regel uit het logboek (weggegooid/opgemaakt).
const vanSoort = (data, slug) => (x) => soortVan(data, x.ingredient) === soortVan(data, slug);
const kopie = (data, slug) => data.voorraad.ingredienten.filter(vanSoort(data, slug)).map((x) => ({ ...x }));
const terugzetten = (data, slug, voor, logId = null) => async () => {
  if (logId) {
    await wijzig("logboek", (doc) => {
      doc.weggegooid = doc.weggegooid.filter((x) => x.id !== logId);
      doc.opgemaakt = (doc.opgemaakt || []).filter((x) => x.id !== logId);
    });
  }
  const zelfde = vanSoort(data, slug);
  await wijzig("voorraad", (doc) => { doc.ingredienten = [...doc.ingredienten.filter((x) => !zelfde(x)), ...voor]; });
};

// Een partij weghalen, altijd met "Ongedaan maken":
//   "op"   opgemaakt: in het logboek, en de komende twee weken op de boodschappenlijst
//   "weg"  weggegooid (bedorven): in het logboek
//   "fout" verkeerd ingevoerd: gewoon weg, nergens bijgehouden
async function weghalen(data, p, hoe) {
  const naam = data.ingredienten[p.ingredient]?.naam || p.ingredient;
  const voor = kopie(data, p.ingredient);
  const logId = hoe === "fout" ? null : nieuwId();
  if (logId) {
    await wijzig("logboek", (doc) => {
      const regel = { id: logId, datum: vandaag(), ingredient: p.ingredient };
      if (hoe === "op") (doc.opgemaakt ||= []).push(regel);
      else doc.weggegooid.push({ ...regel, ...(p.hoeveelheid != null ? { hoeveelheid: p.hoeveelheid, eenheid: p.eenheid } : {}) });
    });
  }
  const d = await wijzig("voorraad", (doc) => { doc.ingredienten = doc.ingredienten.filter((x) => x.id !== p.id); });
  melding({ op: `${naam} is op`, weg: `${naam} weggegooid`, fout: `${naam} verwijderd` }[hoe], terugzetten(data, p.ingredient, voor, logId));
  return d;
}

// "Open" voor een verpakking; bij uien, citroenen e.d. "Aansnijden" (één stuk, de rest blijft
// heel). Een zak aardappelen in gram gaat nooit open: geen knop.
function openKnop(p, data) {
  const ing = ingVan(data, p.ingredient);
  if (p.geopend || p.hoeveelheid == null || !ing) return "";
  if (perStuk(ing)) {
    return aansnijdbaar(p, ing, data.eenheden)
      ? `<button class="knop klein" data-open title="Eén stuk aansnijden; de rest blijft heel">Aansnijden</button>` : "";
  }
  return `<button class="knop klein" data-open title="Een verpakking openen">Open</button>`;
}

export function voorraad(main, data) {
  const herteken = (d) => voorraad(main, d);
  const e = data.eenheden;
  const partijen = data.voorraad.ingredienten
    .map((p) => ({ p, ing: data.ingredienten[p.ingredient] }))
    .sort((a, b) => (a.ing?.naam || a.p.ingredient).localeCompare(b.ing?.naam || b.p.ingredient, "nl")
      || (a.p.geopend ? 0 : 1) - (b.p.geopend ? 0 : 1) || (a.p.gekocht || "").localeCompare(b.p.gekocht || ""));
  // Wat gauw op moet (ingrediënten binnen 3 dagen, porties die al een tijdje liggen) staat bovenaan
  // in één groep, en niet nog eens bij zijn plek.
  const gauwIds = new Set(gauwOp(data).map((x) => x.p.id));
  const oudIds = new Set(oudePorties(data).map((p) => p.id));
  const heeftIets = partijen.length || data.voorraad.porties.length;

  main.innerHTML = `
    <div class="kopregel"><h1 class="paginatitel">Voorraad</h1>
      <button class="knop primair" id="nieuw">+ Toevoegen</button></div>
    ${heeftIets ? `<div class="zoekbalk"><input type="search" id="zoek" placeholder="Zoek in voorraad…" value="${esc(f.zoek)}" autocomplete="off"></div>` : ""}
    <div id="lijst"></div>`;

  // Eén partij als rij (met zijn knoppen). `metPlek`: de plek erbij (in de groep "Gauw op").
  const partijRij = ({ p, ing }, metPlek = false) => {
    const onbekendGewicht = p.eenheid && ing && gram({ hoeveelheid: 1, eenheid: p.eenheid }, ingVan(data, p.ingredient), e) == null;
    const wanneer = [metPlek && PLEKNAAM[p.plek].toLowerCase(), p.geopend ? `open sinds ${datumNl(p.geopend)}` : p.gekocht ? `gekocht ${datumNl(p.gekocht)}` : ""]
      .filter(Boolean).join(" · ");
    return `<li data-id="${esc(p.id)}" tabindex="0">
      <span class="v-naam">${esc(ing?.naam || p.ingredient)}
        ${ing ? "" : `<span class="badge waarsch">onbekend ingrediënt</span>`}
        ${onbekendGewicht ? `<span class="badge waarsch" title="Klik om het gewicht in te vullen">gewicht per ${esc(p.eenheid)}?</span>` : ""}
        ${wanneer ? `<small>${esc(wanneer)}</small>` : ""}</span>
      <span class="v-hv">${p.hoeveelheid != null ? esc(toonPartij({ ...p, geopend: null }, data)) : inHuisTekst(p, data)}</span>
      <span class="v-tht">${opBadge(p, data)}</span>
      <span class="v-acties">
        ${openKnop(p, data)}
        <button class="knop klein" data-op title="Op: opgebruikt">Op</button>
        <button class="kruisje" data-weg aria-label="Weggegooid" title="Weggegooid (bederf)">×</button>
      </span>
    </li>`;
  };
  // Meerdere partijen van hetzelfde (pak en pot kikkererwten, een open en een dichte): één regel
  // met alles samen; tikken klapt de partijen open.
  const groepRij = (xs) => {
    if (xs.length === 1) return partijRij(xs[0]);
    const soort = soortVan(data, xs[0].p.ingredient);
    const vroegst = xs.map(({ p }) => p).filter((p) => opTegen(p, data)).sort((a, b) => opTegen(a, data).localeCompare(opTegen(b, data)))[0];
    return `<li class="v-groep" data-groep="${esc(soort)}" tabindex="0" aria-expanded="false">
      <span class="v-naam">${esc(data.ingredienten[soort]?.naam || soort)} <small>${xs.length} partijen · tik om te zien</small></span>
      <span class="v-hv">${esc(toonPartijen(xs.map(({ p }) => p), data))}</span>
      <span class="v-tht">${vroegst ? opBadge(vroegst, data) : ""}</span>
      <span class="v-acties"><span class="v-pijl" aria-hidden="true">▾</span></span>
    </li><li class="v-sub" hidden><ul class="vlijst">${xs.map((x) => partijRij(x)).join("")}</ul></li>`;
  };

  const lijst = main.querySelector("#lijst");
  const toon = () => {
    if (!heeftIets) {
      lijst.innerHTML = `<p class="leeg-tekst">Nog niets in de voorraad. Voeg toe wat je in huis hebt, of
        klik op de boodschappenlijst bij iets op "niet nodig". Een hoeveelheid is niet verplicht: zonder
        hoeveelheid geldt iets als "genoeg in huis".</p>`;
      return;
    }
    const z = f.zoek.toLowerCase();
    const zichtbaar = partijen.filter((x) => !z || (x.ing?.naam || x.p.ingredient).toLowerCase().includes(z));
    const zoekt = (p) => !z || (data.recepten[p.recept]?.titel || p.recept).toLowerCase().includes(z);
    // Gauw op
    const gauwLijst = zichtbaar.filter((x) => gauwIds.has(x.p.id)).sort((a, b) => opTegen(a.p, data).localeCompare(opTegen(b.p, data)));
    const gauwPorties = portiesHtml(data, { zoek: f.zoek, filter: (p) => oudIds.has(p.id) });
    const gauwVak = gauwLijst.length || gauwPorties ? `<section class="plekvak gauw">
      <h2 class="plekkop">Gauw op <small>eerst opmaken</small></h2>
      ${gauwPorties}
      ${gauwLijst.length ? `<ul class="vlijst">${gauwLijst.map((x) => partijRij(x, true)).join("")}</ul>` : ""}
      ${gauwLijst.length ? `<p class="hint"><a href="#/menu/voorraad">Recepten die dit gebruiken →</a></p>` : ""}
    </section>` : "";
    // Per plek één vak: eerst wat je zelf gekookt hebt, dan de ingrediënten (per soort), en wat
    // zonder hoeveelheid "in huis" is (kruiden, olie…) op één regel.
    const vakken = PLEKKEN.map(([plek, naam]) => {
      const hier = zichtbaar.filter((x) => x.p.plek === plek && !gauwIds.has(x.p.id));
      const inHuis = hier.filter((x) => x.p.hoeveelheid == null && !opBadge(x.p, data) && bijnaOp([x.p], data) == null);
      const rijen = hier.filter((x) => !inHuis.includes(x));
      const groepen = new Map();
      for (const x of rijen) {
        const s = soortVan(data, x.p.ingredient);
        groepen.set(s, [...(groepen.get(s) || []), x]);
      }
      const porties = plek === "kast" ? "" : portiesHtml(data, { plek, zoek: f.zoek, filter: (p) => !oudIds.has(p.id) && zoekt(p) });
      if (z && !hier.length && !porties) return "";
      const telling = [porties && "zelfgekookt", hier.length && `${hier.length} ${hier.length === 1 ? "ingrediënt" : "ingrediënten"}`].filter(Boolean).join(" · ");
      return `<section class="plekvak ${plek}">
        <h2 class="plekkop">${naam} <small>${telling || "leeg"}</small></h2>
        ${porties ? `<h3 class="subkop">Zelfgekookt</h3>${porties}` : ""}
        ${rijen.length ? `${porties ? `<h3 class="subkop">Ingrediënten</h3>` : ""}<ul class="vlijst">${[...groepen.values()].map(groepRij).join("")}</ul>` : ""}
        ${inHuis.length ? `<p class="ook-in-huis"><span class="label">Ook in huis</span> ${inHuis.map(({ p, ing }) =>
          `<button type="button" class="linkknop" data-partij="${esc(p.id)}" title="Aanpassen, op of weg">${esc(ing?.naam || p.ingredient)}</button>`).join(", ")}</p>` : ""}
        ${!porties && !hier.length ? `<p class="plek-leeg">Niets in de ${naam.toLowerCase()}.</p>` : ""}
      </section>`;
    }).join("");
    lijst.innerHTML = gauwVak + vakken || `<p class="leeg-tekst">Niets gevonden.</p>`;
    koppelPorties(lijst, data, herteken);
  };
  toon();

  main.querySelector("#zoek")?.addEventListener("input", (ev) => { f.zoek = ev.target.value; toon(); });
  main.querySelector("#nieuw").addEventListener("click", () => partijDialoog(data, null, herteken));
  lijst.addEventListener("click", (ev) => {
    // Groep openklappen; "Ook in huis": de partij aanpassen.
    const groep = ev.target.closest("li.v-groep");
    if (groep) {
      const sub = groep.nextElementSibling;
      sub.hidden = !sub.hidden;
      groep.setAttribute("aria-expanded", String(!sub.hidden));
      return;
    }
    const knop = ev.target.closest("[data-partij]");
    if (knop) return partijDialoog(data, data.voorraad.ingredienten.find((x) => x.id === knop.dataset.partij), herteken);
    const li = ev.target.closest("li[data-id]");
    if (!li) return;
    const p = data.voorraad.ingredienten.find((x) => x.id === li.dataset.id);
    if (!p) return;
    const ing = data.ingredienten[p.ingredient];
    const naam = ing?.naam || p.ingredient;
    if (ev.target.closest("[data-weg]")) {
      weghalen(data, p, "weg").then(herteken, fout);
    } else if (ev.target.closest("[data-op]")) {
      weghalen(data, p, "op").then(herteken, fout);
    } else if (ev.target.closest("[data-open]")) {
      const voor = kopie(data, p.ingredient);
      wijzig("voorraad", (doc) => {
        const anders = doc.ingredienten.filter((x) => x.ingredient !== p.ingredient);
        doc.ingredienten = [...anders, ...openen(doc.ingredienten.filter((x) => x.ingredient === p.ingredient), p.id, data)];
      }).then((d) => {
        const ri = ingVan(data, p.ingredient);
        const b = bewaren(ri, data);
        const waar = b.open_plek !== p.plek ? `, bewaren in de ${b.open_plek}` : "";
        melding(perStuk(ri) ? `Eén ${ri.stuknaam?.[0] || "stuk"} aangesneden: binnen ±${b.open} dagen op${waar}. De rest blijft heel.`
          : `${naam} is open: binnen ±${b.open} dagen op${waar}`, terugzetten(data, p.ingredient, voor));
        herteken(d);
      }, fout);
    } else {
      partijDialoog(data, p, herteken);
    }
  });
  lijst.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.matches("li.v-groep")) return ev.target.click();
    const li = ev.target.closest("li[data-id]");
    if (li && ev.target === li && ev.key === "Enter") {
      partijDialoog(data, data.voorraad.ingredienten.find((x) => x.id === li.dataset.id), herteken);
    }
  });
}

// Toevoegen (p null) of wijzigen van een partij.
function partijDialoog(data, p, klaar) {
  const e = data.eenheden;
  let slug = p?.ingredient || null; // wat bij "Ingrediënt" gekozen is (kan een variant zijn)
  // "Wat": de verpakkingen van de soort en zijn varianten ("pot (400g) · Kikkererwten (Pot)"),
  // of losse eenheden. De keuze bepaalt ook de variant van de partij (zie verpakkingOpties).
  let opties = [];
  const keuze = () => opties.find((o) => o.waarde === form.wat.value) || null;
  // Het ingrediënt van de partij (de gekozen variant), om mee te rekenen.
  const huidig = () => { const s = keuze()?.slug || slug; return s ? ingVan(data, s) : null; };
  const vulOpties = () => {
    opties = slug ? verpakkingOpties(data, slug, { vrij: true })
      : voorraadEenheden(e).map((x) => ({ waarde: `|${x}`, slug: null, eenheid: x, tekst: x === "stuk" ? "stuks" : x }));
    if (p?.eenheid && !opties.some((o) => o.slug === p.ingredient && o.eenheid === p.eenheid)) {
      opties.unshift({ waarde: `${p.ingredient}|${p.eenheid}`, slug: p.ingredient, eenheid: p.eenheid, tekst: p.eenheid });
    }
    // Bestaande partij: wat er stond; anders de verpakking van het gekozen merk, of de eerste (wat je normaal koopt).
    const gekozen = (p?.eenheid && `${p.ingredient}|${p.eenheid}`) || (slug ? eersteOptie(opties, slug)?.waarde : "|g");
    form.wat.innerHTML = opties.map((o) => `<option value="${esc(o.waarde)}" ${o.waarde === gekozen ? "selected" : ""}>${esc(o.tekst)}</option>`).join("");
  };
  const dlg = document.createElement("dialog");
  dlg.className = "dialoog";
  dlg.innerHTML = `<form novalidate>
    <h2 class="dl-kop">${p ? esc(data.ingredienten[slug]?.naam || slug) : "Toevoegen aan voorraad"}</h2>
    ${p ? "" : `<label class="veld"><span>Ingrediënt</span>
      <input name="ingredient" list="v-ingredienten" autocomplete="off" required>
      ${ingredientKeuzelijst(data, "v-ingredienten")}
      <small>Staat het er niet bij? Maak het eerst aan bij <a href="#/ingredient/nieuw">Ingrediënten</a>.</small></label>`}
    <div class="twee">
      <label class="veld"><span>Hoeveel</span><input name="hoeveelheid" type="number" step="any" min="0"
        value="${p?.hoeveelheid ?? ""}" placeholder="leeg = genoeg"></label>
      <label class="veld"><span>Wat</span><select name="wat"></select></label>
    </div>
    <label class="veld" data-gewicht hidden><span></span>
      <input name="gewicht" type="number" step="any" min="0" placeholder="bv. 500">
      <small>Wordt bij het ingrediënt bewaard, zodat de app stuks/verpakkingen kan omrekenen naar recepten.
        <span data-uitlek hidden>Bij blikken en potten: het uitlekgewicht, zoals in recepten.</span></small></label>
    <p class="hint" data-advies></p>
    <details class="dl-meer"${p ? " open" : ""}><summary>Meer: waar, datums, vaste voorraad</summary>
      <div class="twee">
        <label class="veld"><span>Waar</span><select name="plek">${PLEKKEN.map(([x, n]) =>
          `<option value="${x}" ${x === (p?.plek || (slug && standaardPlek(ingVan(data, slug), data))) ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="veld"><span>Gekocht</span><input name="gekocht" type="date" max="${vandaag()}" value="${p ? p.gekocht || "" : vandaag()}"></label>
      </div>
      <div class="twee">
        <label class="veld"><span>Geopend</span><input name="geopend" type="date" max="${vandaag()}" value="${p?.geopend || ""}"><small>leeg = nog dicht</small></label>
        <label class="veld"><span>Houdbaar tot (tht)</span><input name="tht" type="date" value="${p?.tht || ""}"><small>alleen als je die wilt gebruiken</small></label>
      </div>
      <div class="twee">
        <label class="veld"><span>Altijd minstens in huis</span><input name="minimum" type="number" step="any" min="0"
          placeholder="leeg = geen vaste voorraad"><small>daaronder komt het op de boodschappenlijst</small></label>
        <label class="veld"><span>Eenheid</span><select name="min_eenheid">${voorraadEenheden(e).map((x) => `<option>${x}</option>`).join("")}</select></label>
      </div>
    </details>
    <p class="fout" hidden></p>
    <div class="knoppen"><button class="knop primair" type="submit">Opslaan</button>
      ${p ? `<button class="knop" type="button" data-op title="Opgemaakt: komt in het logboek en op de boodschappenlijst">Op</button>
        <button class="knop" type="button" data-fout title="Per ongeluk toegevoegd: weghalen zonder iets bij te houden">Verkeerd ingevoerd</button>` : ""}
      <button class="knop" type="button" data-annuleer>Annuleren</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form");
  const foutEl = dlg.querySelector(".fout");
  const gewichtVeld = dlg.querySelector("[data-gewicht]");
  const advies = dlg.querySelector("[data-advies]");
  const toonFout = (t) => { foutEl.textContent = t; foutEl.hidden = false; };
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelector("[data-annuleer]").addEventListener("click", () => dlg.close());
  dlg.querySelector("a")?.addEventListener("click", () => dlg.close());
  let plekGekozen = !!p;
  form.plek.addEventListener("change", () => { plekGekozen = true; });

  vulOpties();
  const eenheidNu = () => keuze()?.eenheid || "g";
  const partijSlug = () => keuze()?.slug || slug;
  // Vraag het gewicht per stuk/verpakking als het ingrediënt dat nog niet weet. Staat het in de
  // Jumbo-link ("volgens Jumbo"), dan is het al ingevuld.
  form.gewicht.addEventListener("input", () => { form.gewicht.dataset.zelf = "1"; });
  const nodigGewicht = () => {
    const ing = huidig();
    const eh = eenheidNu();
    return ing && form.hoeveelheid.value.trim() !== "" && (eh === "stuk" || e[eh]?.verpakking)
      && gram({ hoeveelheid: 1, eenheid: eh }, ing, e) == null;
  };
  const bijwerken = () => {
    gewichtVeld.hidden = !nodigGewicht();
    gewichtVeld.querySelector("span").textContent = `Gewicht per ${eenheidNu()} (gram)`;
    const o = keuze();
    if (o?.nieuw && !form.gewicht.dataset.zelf) form.gewicht.value = o.gram;
    const ing = huidig();
    gewichtVeld.querySelector("[data-uitlek]").hidden = !["blik", "pot"].includes(eenheidNu());
    if (!ing) { advies.textContent = ""; return; }
    const b = bewaren(ing, data);
    const voorbeeld = { plek: form.plek.value, gekocht: form.gekocht.value || null, geopend: form.geopend.value || null, tht: form.tht.value || null };
    const op = opTegen({ ...voorbeeld, ingredient: partijSlug() }, data);
    advies.textContent = `Bewaaradvies: ${PLEKNAAM[b.plek].toLowerCase()}, ${perStuk(ing)
      ? `heel ±${b.dagen} dagen (ook als je er een paar uit de zak haalt), aangesneden ±${b.open} dagen`
      : `dicht ±${b.dagen} dagen, na openen ±${b.open} dagen`}`
      + `${b.open_plek !== b.plek ? ` in de ${b.open_plek}` : ""}.${op ? ` Dus op voor ${datumNl(op)}.` : ""}`;
  };
  // Vaste voorraad van dit ingrediënt (geldt voor de soort, dus alle merken samen).
  const toonMinimum = () => {
    const m = slug && minimumVan(data, slug);
    form.minimum.value = m ? m.hoeveelheid : "";
    if (m) dlg.querySelector(".dl-meer").open = true; // vaste voorraad: laten zien
    form.min_eenheid.value = m?.eenheid || (voorraadEenheden(e).includes(eenheidNu()) ? eenheidNu() : "g");
  };
  // Ingrediënt gekozen (uit de lijst, of getypt): de keuzes bij "Wat" horen daarbij.
  const ingredientGekozen = () => {
    const nieuw = vindIngredient(data, form.ingredient.value);
    if (nieuw === slug) return;
    slug = nieuw;
    vulOpties();
    delete form.gewicht.dataset.zelf;
    const ing = huidig();
    if (ing && !plekGekozen) form.plek.value = standaardPlek(ing, data);
    toonMinimum();
    bijwerken();
  };
  form.ingredient?.addEventListener("input", ingredientGekozen);
  form.ingredient?.addEventListener("change", ingredientGekozen);
  form.wat.addEventListener("change", () => {
    delete form.gewicht.dataset.zelf;
    const ing = huidig();
    if (ing && !plekGekozen) form.plek.value = standaardPlek(ing, data);
    bijwerken();
  });
  for (const veld of ["hoeveelheid", "plek", "gekocht", "geopend", "tht"]) form[veld].addEventListener("input", bijwerken);
  toonMinimum();
  bijwerken();

  const opslaan = (fn, tekst, ongedaan) => wijzig("voorraad", fn)
    .then((d) => { dlg.close(); melding(tekst, ongedaan); klaar(d); }, (err) => toonFout(err.message));

  for (const [knop, hoe] of [["[data-op]", "op"], ["[data-fout]", "fout"]]) {
    dlg.querySelector(knop)?.addEventListener("click", () =>
      weghalen(data, p, hoe).then((d) => { dlg.close(); klaar(d); }, (err) => toonFout(err.message)));
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!p) slug = vindIngredient(data, form.ingredient.value);
    if (!slug) {
      const t = form.ingredient.value.trim().toLowerCase();
      const k = t ? kandidaten(data, t).map((x) => data.ingredienten[x].naam) : [];
      return toonFout(k.length > 1 && k.length <= 8 ? `Welke bedoel je: ${k.join(", ")}?` : "Kies een ingrediënt uit de lijst.");
    }
    const lot = partijSlug(); // de gekozen variant (pot of pak), anders het ingrediënt zelf
    const ing = ingVan(data, lot);
    const hTekst = form.hoeveelheid.value.trim();
    const h = hTekst === "" ? null : Number(hTekst.replace(",", "."));
    if (h != null && !(h > 0)) return toonFout("Vul een hoeveelheid groter dan 0 in, of laat het leeg.");
    const eenheid = eenheidNu();
    if (form.geopend.value && form.gekocht.value && form.geopend.value < form.gekocht.value) {
      return toonFout("Geopend kan niet vóór gekocht liggen.");
    }
    const mTekst = form.minimum.value.trim();
    const minimum = mTekst === "" ? null : { hoeveelheid: Number(mTekst.replace(",", ".")), eenheid: form.min_eenheid.value };
    if (minimum && !(minimum.hoeveelheid > 0)) return toonFout("Vul bij 'altijd minstens in huis' een getal groter dan 0 in, of laat het leeg.");
    if (minimum && gram(minimum, ing, e) == null && minimum.eenheid !== eenheid) {
      return toonFout(`De app weet niet hoeveel één ${minimum.eenheid} weegt; kies een andere eenheid voor de vaste voorraad.`);
    }
    // Alleen opslaan als het veranderd is.
    const oudMin = minimumVan(data, slug);
    if (JSON.stringify(oudMin) !== JSON.stringify(minimum)) {
      try {
        await wijzig("instellingen", (doc) => {
          doc.minimum ||= {};
          if (minimum) doc.minimum[soortVan(data, slug)] = minimum; else delete doc.minimum[soortVan(data, slug)];
        });
      } catch (err) {
        return toonFout(err.message);
      }
    }

    // Gewicht per stuk/verpakking eerst bij het ingrediënt opslaan.
    if (nodigGewicht()) {
      const g = Number(form.gewicht.value.replace(",", "."));
      if (!(g > 0)) return toonFout(`Vul in hoeveel gram één ${eenheid} weegt, dan kan de app ermee rekenen.`);
      // Bij een algemene soort hoort het gewicht bij het standaardmerk. Altijd het eigen
      // ingrediënt opslaan, nooit de samengevoegde rekenversie.
      const doel = data.ingredienten[lot].standaard || lot;
      const eigen = data.ingredienten[doel];
      try {
        await bewaarIngredient(doel, { ...eigen, gram_per: { ...(eigen.gram_per || {}), [eenheid]: g } });
        Object.assign(data, await laad(true));
      } catch (err) {
        return toonFout(err.message);
      }
    }

    const velden = {
      plek: plekGekozen || p ? form.plek.value : standaardPlek(ing, data),
      ...(h != null ? { hoeveelheid: rond(h, eenheid, e) || h, eenheid } : {}),
      ...(form.gekocht.value ? { gekocht: form.gekocht.value } : {}),
      ...(form.geopend.value ? { geopend: form.geopend.value } : {}),
      ...(form.tht.value ? { tht: form.tht.value } : {}),
      ...(p?.geteld && h == null ? { geteld: p.geteld } : {}),
    };
    // Ongedaan maken zet de hele soort terug (de partij kan van variant veranderd zijn).
    const voor = kopie(data, p?.ingredient || lot);
    opslaan((doc) => {
      if (p) {
        const i = doc.ingredienten.findIndex((x) => x.id === p.id);
        const nieuw = { id: p.id, ingredient: lot, ...velden };
        if (i >= 0) doc.ingredienten[i] = nieuw; else doc.ingredienten.push(nieuw);
        return;
      }
      // Zelfde dag gekocht, zelfde plek en eenheid, nog dicht: optellen bij die partij.
      const zelfde = h != null && !velden.geopend && !velden.tht && doc.ingredienten.find((x) => x.ingredient === lot
        && !x.geopend && !x.tht && x.plek === velden.plek && x.eenheid === eenheid && x.gekocht === velden.gekocht && x.hoeveelheid != null);
      if (zelfde) zelfde.hoeveelheid = rond(zelfde.hoeveelheid + velden.hoeveelheid, eenheid, e);
      else doc.ingredienten.push({ id: nieuwId(), ingredient: lot, ...velden });
    }, p ? "Opgeslagen" : `${ing.naam} staat in de voorraad`, terugzetten(data, p?.ingredient || lot, voor));
  });
  dlg.showModal();
  (form.ingredient || form.hoeveelheid).focus();
}
