import { laad, taak, wijzig } from "../store.js";
import { gram } from "../voeding.js";
import { aanbiedingenVan, aanbiedingTekst, besteVerpakking, boodschappenlijst, eersteOptie, heeftAanbiedingen, ingVan, inVoorraad,
  koopAdvies, normaalPrijs, PLEKKEN, prijsVan, prijsVanPakken, rond, sleutelExtra, soortVan, standaardPlek, teKoken,
  toonHoeveelheid, toonPartijen, verpakkingen, verpakkingOpties, voorraadEenheden } from "../planning.js";
import { breuk, datumNl, esc, euro, groepNaam, melding, nieuwId, nl, vandaag } from "../util.js";
import { ingredientKeuzelijst, vindIngredient } from "./voorraad.js";

const fout = (err) => melding(err.message);
// Uitkomst van de laatste keer "Prijzen en aanbiedingen bijwerken" (blijft staan tot je de pagina verlaat).
let verslag = null;
let bezig = false;

// "Jumbo Tofu Naturel 375g: € 1,00 (€ 2,67/kg, normaal € 3,60/kg), t/m di 24 nov"
const actieDetail = (a, data) => `${a.product}${a.hoeveelheid && !a.product.includes(a.hoeveelheid) ? ` (${a.hoeveelheid})` : ""}: ${euro(a.prijs)}${
  normaalPrijs(data, a) ? ` (${euro(a.per_kg)}/kg, normaal ${euro(normaalPrijs(data, a))}/kg)` : ""}, ${
  a.vanaf > vandaag() ? `vanaf ${datumNl(a.vanaf)} ` : ""}t/m ${datumNl(a.tot)}`;
const actieHtml = (a, data) => (a ? ` <span class="b-actie" title="${esc(actieDetail(a, data))}">${esc(aanbiedingTekst(a))}</span>` : "");

// Ongeveer de looproute door de supermarkt; onbekende groepen komen daarna.
const ROUTE = ["fruit-en-groente", "brood", "vlees-en-vleesvervangers", "zuivel-en-kaas", "pasta-en-rijst",
  "conserven-en-peulvruchten", "sauzen-en-smaakmakers", "kruiden-en-specerijen", "olie-en-vet",
  "ontbijt-en-bakken", "snacks", "diepvries", "overig"];
const ZONDER_GROEP = "~extra";
const groepTitel = (g) => (g === ZONDER_GROEP ? "Overig" : groepNaam(g));
const volgorde = (g) => (g === ZONDER_GROEP ? 999 : ROUTE.indexOf(g) === -1 ? 500 : ROUTE.indexOf(g));

// Verpakkingen voor een item van de lijst. Met vaste voorraad ("altijd 3 pakken"): het deel voor het
// menu zo passend mogelijk (pot of pak), de vaste voorraad in wat je normaal koopt.
function koopPakken(x, data) {
  const g = (lijst) => {
    let s = 0;
    for (const q of lijst) {
      const y = gram(q, x.ing, data.eenheden);
      if (y == null) return null;
      s += y;
    }
    return s;
  };
  const mg = x.minimum ? g([x.minimum]) : 0;
  const rg = g(x.rest);
  if (!x.minimum || mg == null || rg == null || rg <= mg + 1) return besteVerpakking(x.rest, x.slug, data, !!x.minimum);
  const menu = besteVerpakking([{ hoeveelheid: rg - mg, eenheid: "g" }], x.slug, data);
  const vast = besteVerpakking([x.minimum], x.slug, data, true);
  if (!menu || !vast) return besteVerpakking(x.rest, x.slug, data, true);
  const samen = [];
  for (const p of [...menu, ...vast]) {
    const zelfde = samen.find((y) => y.slug === p.slug && y.eenheid === p.eenheid);
    if (zelfde) { zelfde.hoeveelheid += p.hoeveelheid; zelfde.gram += p.gram; } else samen.push({ ...p });
  }
  return samen;
}

export function boodschappen(main, data) {
  const herteken = (d) => boodschappen(main, d);
  const lijst = boodschappenlijst(data);
  const af = new Set(data.boodschappen.afgevinkt);
  const gerechten = teKoken(data);
  const e = data.eenheden;

  // Alles wat je moet kopen: uit de recepten, plus wat je zelf hebt toegevoegd.
  const rijen = [
    ...lijst.filter((x) => x.status === "kopen").map((x) => {
      // In hele verpakkingen, met zo min mogelijk over: "1 pot (400g nodig)" (zie besteVerpakking).
      const alleenOp = x.opgemaakt && !x.rest.length;
      let pakken = koopPakken(x, data);
      // Op en verder niets nodig: één verpakking van wat je normaal koopt (als bekend is hoe je het koopt).
      if (alleenOp) {
        const v = verpakkingen(data, x.slug)[0];
        pakken = v ? [{ slug: v.slug, hoeveelheid: 1, eenheid: v.eenheid, gram: v.gram }] : null;
      }
      const pakTekst = pakken && toonHoeveelheid(pakken, e);
      // Eén korte reden onder de naam; de rest (in huis, aanbieding, wanneer) achter ▾.
      const recepten = [...x.recepten];
      const kort = recepten.length ? `voor ${recepten.slice(0, 2).join(", ")}${recepten.length > 2 ? ` +${recepten.length - 2}` : ""}`
        : x.minimum ? "vaste voorraad" : x.opgemaakt ? `op sinds ${datumNl(x.opgemaakt)}` : "";
      const waarom = [
        recepten.length > 2 && `voor ${recepten.join(", ")}`,
        x.minimum && `vaste voorraad: minstens ${toonHoeveelheid([x.minimum], e, x.ing)}`,
        x.opgemaakt && recepten.length && `op sinds ${datumNl(x.opgemaakt)}`,
      ].filter(Boolean).join(" · ");
      // In de aanbieding ergens tussen nu en wanneer je het nodig hebt.
      const actie = aanbiedingenVan(data, x.slug, vandaag(), x.dag > vandaag() ? x.dag : vandaag())[0];
      return {
        sleutel: x.sleutel, slug: x.slug, ing: x.ing, naam: x.ing.naam, groep: x.ing.groep,
        // Wat je koopt: verpakkingen (met de variant: pot of pak), of de hoeveelheden zelf.
        standaard: pakken || x.rest.map((q) => ({ ...q, slug: x.slug })),
        later: x.later, prijs: pakken ? prijsVanPakken(pakken, x.slug, data) : prijsVan(x.rest, x.ing, e), alleenOp, actie,
        hv: alleenOp ? pakTekst || "is op" : pakTekst || toonHoeveelheid(x.rest, e, x.ing),
        kort,
        detail: [waarom,
          pakken && !alleenOp && `nodig: ${toonHoeveelheid(x.rest, e, x.ing)}`,
          x.later && `nodig op ${datumNl(x.dag)}, koop vanaf ${datumNl(x.later)}`,
          x.partijen.length && `in huis: ${toonPartijen(x.partijen, data)}`,
          actie && `aanbieding ${actieDetail(actie, data)}`].filter(Boolean).join(" · "),
      };
    }),
    ...data.boodschappen.extra.map((x) => {
      const ing = data.ingredienten[x.ingredient];
      const actie = ing ? aanbiedingenVan(data, soortVan(data, x.ingredient))[0] : null;
      return { sleutel: sleutelExtra(x.id), extraId: x.id, slug: ing ? x.ingredient : null, ing,
        naam: x.naam, groep: ing?.groep || ZONDER_GROEP, standaard: [], hv: "", actie, kort: "",
        detail: actie ? `aanbieding ${actieDetail(actie, data)}` : "", prijs: null };
    }),
  ];
  // Wat zelf al op de lijst staat (extra's), per soort.
  const extraSoorten = new Set(data.boodschappen.extra.filter((x) => x.ingredient && data.ingredienten[x.ingredient])
    .map((x) => soortVan(data, x.ingredient)));
  // Even nakijken: "in huis" en naar schatting bijna op. Nog genoeg, of kopen?
  const nakijken = lijst.filter((x) => x.status === "nakijken" && !extraSoorten.has(x.slug))
    .sort((a, b) => a.ing.naam.localeCompare(b.ing.naam, "nl"));
  // Slim inslaan: in de aanbieding, blijft lang goed, gebruik je vaak. Niet wat al op de lijst staat.
  const inslaan = koopAdvies(data, lijst).filter((x) => !extraSoorten.has(x.slug));
  // De knop alleen als er producten gekoppeld zijn (anders doet hij niets).
  const gekoppeld = Object.values(data.ingredienten).some((i) => i.product || i.alternatieven);
  const opgehaald = data.aanbiedingen?.opgehaald;
  const inHuis = lijst.filter((x) => x.status === "genoeg" || x.status === "onzeker");
  // Nu kopen, en verse dingen die pas later in de week nodig zijn apart.
  const nu = rijen.filter((r) => !r.later);
  const later = rijen.filter((r) => r.later).sort((a, b) => a.later.localeCompare(b.later));
  const groepen = [...new Set(nu.map((r) => r.groep))]
    .sort((a, b) => volgorde(a) - volgorde(b) || a.localeCompare(b, "nl"));
  const aantalAf = rijen.filter((r) => af.has(r.sleutel)).length;
  const metPrijs = nu.filter((r) => r.prijs != null && !af.has(r.sleutel));
  const zonderPrijs = nu.filter((r) => r.prijs == null && !r.extraId && !af.has(r.sleutel)).length;
  const totaal = metPrijs.reduce((s, r) => s + r.prijs, 0);
  const onderdelen = lijst.onderdelen.reduce((m, o) => m.set(o.recept, (m.get(o.recept) || 0) + o.keer), new Map());

  // Eén regel: vinkje, naam, hoeveel, prijs. Eronder één korte reden; ▾ toont de rest.
  // "Niet nodig" doet wat past: iets dat op was niet opnieuw voorstellen, anders "heb ik al" (in huis).
  const rijHtml = (r) => `<li class="b-item${af.has(r.sleutel) ? " af" : ""}" data-sleutel="${esc(r.sleutel)}">
    <label class="b-vink"><input type="checkbox" ${af.has(r.sleutel) ? "checked" : ""}>
      <span class="b-tekst"><span class="b-naam">${esc(r.naam)}</span>${r.hv ? ` <span class="b-hv">${esc(r.hv)}</span>` : ""}${actieHtml(r.actie, data)}</span></label>
    ${r.prijs != null ? `<span class="b-prijs">±${esc(euro(r.prijs))}</span>` : ""}
    <span class="b-acties">
      ${r.detail ? `<button class="mini" data-meer aria-expanded="false" aria-label="Meer over ${esc(r.naam)}" title="Meer">▾</button>` : ""}
      ${r.slug && !r.extraId ? `<button class="knop klein" data-nietnodig title="${r.alleenOp ? "Niet opnieuw kopen" : "Heb ik al: staat in de voorraad als 'genoeg in huis'"}">niet nodig</button>` : ""}
      ${r.extraId ? `<button class="kruisje" data-extraweg aria-label="Weghalen" title="Weghalen">×</button>` : ""}
    </span>
    ${r.kort ? `<small class="b-detail">${esc(r.kort)}</small>` : ""}
    ${r.detail ? `<small class="b-detail b-extra" hidden>${esc(r.detail)}</small>` : ""}</li>`;

  // "Voor 5 maaltijden (wo–vr)", open te klappen naar de gerechten zelf.
  const dagenMenu = gerechten.map((g) => g.dag).filter(Boolean).sort();
  const periode = dagenMenu.length ? ` (${datumNl(dagenMenu[0]).split(" ")[0]}${dagenMenu.at(-1) !== dagenMenu[0] ? `–${datumNl(dagenMenu.at(-1)).split(" ")[0]}` : ""})` : "";
  const winkel = gekoppeld ? `<div class="b-winkel">
      <span class="b-winkelstatus">${heeftAanbiedingen(data)
        ? `Aanbiedingen van AH en Jumbo, opgehaald ${esc(datumNl(opgehaald))}`
        : opgehaald ? `De aanbiedingen van ${esc(datumNl(opgehaald))} zijn verlopen` : "Nog geen aanbiedingen opgehaald"}
        <small>(via <a href="https://www.prijsprofeet.nl" target="_blank" rel="noopener">PrijsProfeet</a>; alleen wat per kg
          minstens 10% goedkoper is dan normaal; controleer de prijs in de winkel)</small></span>
      <span class="alleen-laptop b-winkelknoppen">
        <button class="knop klein" data-taak="bijwerken" ${bezig ? "disabled" : ""}
          title="Haalt de gewone Jumboprijzen en de aanbiedingen van AH en Jumbo op (±2 minuten)">${bezig ? "Bezig…" : "Prijzen en aanbiedingen bijwerken"}</button>
        <span class="b-taakstatus" aria-live="polite"></span>
      </span>
    </div>` : "";

  main.innerHTML = `
    <div class="kopregel"><h1 class="paginatitel">Boodschappen</h1>
      ${rijen.length ? `<button class="knop" id="kopieer">Lijst kopiëren</button>` : ""}</div>
    ${gerechten.length ? `<details class="voor"><summary>Voor ${gerechten.length} ${gerechten.length === 1 ? "maaltijd" : "maaltijden"}${esc(periode)}${
      metPrijs.length ? ` · ±${esc(euro(totaal))}${zonderPrijs ? ` <small>(+ ${zonderPrijs} zonder prijs)</small>` : ""}` : ""}</summary>
      <p>${gerechten.map((g) => `<a href="#/recept/${esc(g.recept)}">${esc(data.recepten[g.recept].titel)}</a> <small>(${g.porties}${g.dag ? `, ${esc(datumNl(g.dag))}` : ""})</small>`).join(", ")}
        · <a href="#/">menu aanpassen</a></p>
      ${onderdelen.size ? `<p class="hint">Al gemaakt, uit de koelkast/vriezer: ${[...onderdelen].map(([id, keer]) =>
        `${esc(data.recepten[id]?.titel || id)} (${breuk(keer)}×)`).join(", ")}. Daarvoor hoef je niets te kopen.</p>` : ""}</details>`
      : `<p class="voor">Er staat nog niets op het menu. <a href="#/">Kies wat je gaat eten</a>, dan komen de ingrediënten hier vanzelf.</p>`}
    <form class="b-toevoegen" autocomplete="off">
      <input name="naam" list="b-ingredienten" placeholder="Zelf iets toevoegen, bv. melk of wc-papier" aria-label="Zelf iets toevoegen">
      ${ingredientKeuzelijst(data, "b-ingredienten")}
      <button class="knop" type="submit">Toevoegen</button>
    </form>
    ${nu.length ? groepen.map((g) => `<section class="categorie"><h2>${esc(groepTitel(g))}</h2>
      <ul class="blijst">${nu.filter((r) => r.groep === g).sort((a, b) => a.naam.localeCompare(b.naam, "nl")).map(rijHtml).join("")}</ul></section>`).join("")
      : gerechten.length && !later.length ? `<p class="leeg-tekst">Je hebt alles in huis.</p>` : ""}
    ${later.length ? `<section class="categorie later"><h2>Later kopen <small>vers houden: pas later in de week nodig</small></h2>
      <ul class="blijst">${later.map(rijHtml).join("")}</ul></section>` : ""}
    ${aantalAf ? `<div class="knoppen b-klaar"><button class="knop primair" id="naar-voorraad">Klaar met winkelen: ${aantalAf} afgevinkt in de voorraad zetten…</button></div>` : ""}
    ${nakijken.length ? `<section class="categorie b-nakijken"><h2>Even nakijken <small>naar schatting bijna op: nog genoeg?</small></h2>
      <ul class="blijst">${nakijken.map((x) => `<li class="b-item" data-slug="${esc(x.slug)}">
        <span class="b-naam">${esc(x.ing.naam)}</span>
        <small class="b-detail">naar schatting ±${nl(Math.min(100, Math.round(x.bijnaOp * 10) * 10))}% gebruikt sinds het kopen</small>
        <span class="b-acties"><button class="knop klein" data-genoeg title="Er is nog genoeg: de app begint opnieuw met tellen">Nog genoeg</button>
          <button class="knop klein" data-kopen title="Op de boodschappenlijst">Kopen</button></span></li>`).join("")}</ul></section>` : ""}
    ${inHuis.length ? `<details class="b-inhuis"><summary>Al in huis (${inHuis.length})</summary>
      <ul class="blijst">${inHuis.sort((a, b) => a.ing.naam.localeCompare(b.ing.naam, "nl")).map((x) => `<li class="b-item">
        <span class="b-naam">${esc(x.ing.naam)}</span>
        <small class="b-detail">${x.nodig.length ? `nodig ${esc(toonHoeveelheid(x.nodig, e, x.ing))} · ` : ""}in huis${x.partijen.some((p) => p.hoeveelheid != null)
          ? `: ${esc(toonPartijen(x.partijen.filter((p) => p.hoeveelheid != null), data))}` : ""}${x.status === "onzeker" ? " (genoeg?)" : ""}</small>
      </li>`).join("")}</ul>
      <p class="hint">Klopt iets niet? Pas het aan bij <a href="#/voorraad">Voorraad</a>.</p></details>` : ""}
    ${inslaan.length ? `<section class="categorie b-slim"><h2>Slim inslaan <small>in de aanbieding en lang houdbaar</small></h2>
      <ul class="blijst">${inslaan.map((x) => `<li class="b-item" data-slug="${esc(x.slug)}">
        <span class="b-naam">${esc(x.ing.naam)}</span>${actieHtml(x.a, data)}
        <small class="b-detail">${esc(actieDetail(x.a, data))}</small>
        <span class="b-acties"><button class="knop klein" data-inslaan>+ Op de lijst</button></span></li>`).join("")}</ul></section>` : ""}
    ${winkel}
    ${verslag ? `<details class="b-verslag" open><summary>${esc(verslag.kop)}</summary>${verslag.html}</details>` : ""}`;

  // Prijzen en aanbiedingen bijwerken: alleen als je op de knop drukt.
  main.querySelector("[data-taak]")?.addEventListener("click", async (ev) => {
    const status = main.querySelector(".b-taakstatus");
    bezig = true;
    ev.currentTarget.disabled = true;
    ev.currentTarget.textContent = "Bezig…";
    try {
      const u = await taak("bijwerken", (st) => { status.textContent = `${Math.round(st.voortgang * 100)}% · ${st.tekst}`; });
      const lijst = (xs, f) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(f(x))}</li>`).join("")}</ul>` : "");
      const p = u.prijzen, a = u.aanbiedingen;
      verslag = {
        kop: [p && `${p.veranderd.length} prijzen veranderd${p.verdacht.length ? `, ${p.verdacht.length} om te controleren` : ""}`,
          a && `${a.aantal} aanbiedingen voor ${a.ingredienten} ingrediënten`, u.fouten.length && "niet alles gelukt"]
          .filter(Boolean).join(" · "),
        html: (p ? lijst(p.veranderd, (x) => `${x.naam}: ${x.oud == null ? "nog geen prijs" : euro(x.oud)} → ${euro(x.nieuw)} per kg`)
            + (p.verdacht.length ? `<p>Niet overgenomen (heel andere prijs, misschien een ander product):</p>${lijst(p.verdacht, (x) => x)}` : "")
            + (p.niet_gevonden.length ? `<p>Niet meer gevonden bij Jumbo (prijs blijft zoals hij was):</p>${lijst(p.niet_gevonden, (x) => x)}` : "")
          : "")
          + (u.fouten.length ? `<p>Niet gelukt (de oude gegevens blijven staan):</p>${lijst(u.fouten, (x) => x)}` : ""),
      };
    } catch (err) {
      melding(err.message);
    }
    bezig = false;
    laad(true).then(herteken, fout);
  });

  // Als extra op de lijst (Slim inslaan, of "Kopen" bij Even nakijken).
  const opDeLijst = (slug) => {
    const item = { id: nieuwId(), naam: data.ingredienten[slug].naam, ingredient: slug };
    return wijzig("boodschappen", (doc) => { doc.extra.push(item); }).then(herteken, fout);
  };
  main.querySelectorAll("[data-inslaan], [data-kopen]").forEach((b) => b.addEventListener("click", () => opDeLijst(b.closest("li").dataset.slug)));

  // Afvinken
  const huidige = new Set(rijen.map((r) => r.sleutel));
  main.querySelectorAll(".blijst input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
    const sleutel = cb.closest("li").dataset.sleutel;
    cb.closest("li").classList.toggle("af", cb.checked);
    wijzig("boodschappen", (doc) => {
      const s = new Set(doc.afgevinkt.filter((k) => huidige.has(k)));
      if (cb.checked) s.add(sleutel); else s.delete(sleutel);
      doc.afgevinkt = [...s];
      delete doc.gekocht; // van vroeger: hoeveel je kocht vul je nu in bij "Klaar met winkelen"
    }).then(herteken, fout);
  }));

  // ▾: de rest van de uitleg (in huis, aanbieding, wanneer nodig).
  main.querySelectorAll("[data-meer]").forEach((b) => b.addEventListener("click", () => {
    const extra = b.closest("li").querySelector(".b-extra");
    extra.hidden = !extra.hidden;
    b.setAttribute("aria-expanded", String(!extra.hidden));
    b.textContent = extra.hidden ? "▾" : "▴";
  }));

  // "Niet nodig" bij iets voor het menu of de vaste voorraad: "heb ik al", in de voorraad als genoeg in huis.
  const hebIkAl = (r) => {
    wijzig("voorraad", (doc) => {
      // Een partij zonder hoeveelheid = "genoeg in huis".
      if (!doc.ingredienten.some((p) => soortVan(data, p.ingredient) === r.slug && p.hoeveelheid == null)) {
        // Met datum: vanaf vandaag telt de app hoeveel je ervan gebruikt.
        doc.ingredienten.push({ id: nieuwId(), ingredient: r.slug, plek: standaardPlek(r.ing, data), gekocht: vandaag() });
      }
    }).then((d) => { melding(`${r.naam} staat in de voorraad`); herteken(d); }, fout);
  };

  // "Nog genoeg": de schatting klopte niet; vanaf vandaag opnieuw tellen.
  main.querySelectorAll("[data-genoeg]").forEach((b) => b.addEventListener("click", () => {
    const slug = b.closest("li").dataset.slug;
    const naam = data.ingredienten[slug]?.naam || slug;
    const vanSoort = (p) => soortVan(data, p.ingredient) === slug && p.hoeveelheid == null;
    const voor = data.voorraad.ingredienten.filter(vanSoort).map((p) => ({ ...p }));
    wijzig("voorraad", (doc) => {
      for (const p of doc.ingredienten.filter(vanSoort)) p.geteld = vandaag();
    }).then((d) => {
      melding(`${naam}: de app vraagt het later opnieuw`, () => wijzig("voorraad", (doc) => {
        doc.ingredienten = [...doc.ingredienten.filter((p) => !vanSoort(p)), ...voor];
      }));
      herteken(d);
    }, fout);
  }));

  // "Niet nodig" bij iets dat alleen op de lijst staat omdat het op was: niet meer voorstellen
  // (de regel in het logboek blijft). Anders: heb ik al.
  main.querySelectorAll("[data-nietnodig]").forEach((b) => b.addEventListener("click", () => {
    const r = rijen.find((x) => x.sleutel === b.closest("li").dataset.sleutel);
    if (!r.alleenOp) return hebIkAl(r);
    const ids = new Set((data.logboek.opgemaakt || [])
      .filter((o) => !o.niet_kopen && soortVan(data, o.ingredient) === r.slug).map((o) => o.id));
    const zet = (aan) => wijzig("logboek", (doc) => {
      for (const o of doc.opgemaakt || []) if (ids.has(o.id)) { if (aan) o.niet_kopen = true; else delete o.niet_kopen; }
    });
    zet(true).then((d) => { melding(`${r.naam} staat niet meer op de lijst`, () => zet(false)); herteken(d); }, fout);
  }));

  main.querySelectorAll("[data-extraweg]").forEach((b) => b.addEventListener("click", () => {
    const sleutel = b.closest("li").dataset.sleutel;
    const id = rijen.find((x) => x.sleutel === sleutel).extraId;
    wijzig("boodschappen", (doc) => {
      doc.extra = doc.extra.filter((x) => x.id !== id);
      doc.afgevinkt = doc.afgevinkt.filter((k) => k !== sleutel);
    }).then(herteken, fout);
  }));

  main.querySelector(".b-toevoegen").addEventListener("submit", (e) => {
    e.preventDefault();
    const tekst = e.target.naam.value.trim();
    if (!tekst) return;
    const slug = vindIngredient(data, tekst);
    const item = { id: nieuwId(), naam: slug ? data.ingredienten[slug].naam : tekst, ...(slug ? { ingredient: slug } : {}) };
    wijzig("boodschappen", (doc) => { doc.extra.push(item); }).then((d) => {
      herteken(d);
      main.querySelector(".b-toevoegen input").focus();
    }, fout);
  });

  // Na het winkelen: nakijken wat je kocht, dan in de voorraad.
  main.querySelector("#naar-voorraad")?.addEventListener("click", () => afrekenen(data, rijen.filter((r) => af.has(r.sleutel)), herteken));

  main.querySelector("#kopieer")?.addEventListener("click", () => {
    const regel = (r) => `- ${r.naam}${r.hv ? ` (${r.hv})` : ""}`;
    const laterOpen = later.filter((r) => !af.has(r.sleutel));
    const tekst = [...groepen.map((g) => {
      const open = nu.filter((r) => r.groep === g && !af.has(r.sleutel));
      return open.length ? `${groepTitel(g)}\n${open.map(regel).join("\n")}` : "";
    }), laterOpen.length ? `Later kopen\n${laterOpen.map((r) => `${regel(r)}, vanaf ${datumNl(r.later)}`).join("\n")}` : ""]
      .filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(tekst || "Alles is afgevinkt.")
      .then(() => melding("Gekopieerd: plak het in een berichtje of notitie"), () => melding("Kopiëren lukte niet"));
  });
}

// "Klaar met winkelen": per afgevinkt ingrediënt wat je kocht (welke verpakking, dus ook welke
// variant: pot of pak), hoeveel en waar het heen gaat; alles al ingevuld zoals op de lijst. Leeg =
// "in huis, genoeg". Niet gekocht (uitgevinkt) blijft op de lijst. Dingen zonder ingrediënt
// (wc-papier) gaan gewoon van de lijst.
function afrekenen(data, gekocht, klaar) {
  const e = data.eenheden;
  const items = gekocht.filter((r) => r.ing).map((r) => {
    const opties = verpakkingOpties(data, r.slug);
    const bestaat = (w) => opties.some((o) => o.waarde === w);
    // Beginstand: wat de lijst voorstelde (verpakkingen of hoeveelheden), anders één verpakking.
    let regels = r.standaard.map((q) => ({ waarde: `${q.slug}|${q.eenheid}`, hoeveelheid: rond(q.hoeveelheid, q.eenheid, e) }))
      .filter((x) => bestaat(x.waarde) && voorraadEenheden(e).includes(x.waarde.split("|")[1]));
    if (!regels.length) {
      const pak = eersteOptie(opties, r.slug);
      regels = [{ waarde: pak.waarde, hoeveelheid: pak.gram && (r.extraId || r.alleenOp) ? 1 : "" }];
    }
    const eerste = opties.find((o) => o.waarde === regels[0].waarde);
    return { r, opties, regels, plek: standaardPlek(ingVan(data, eerste?.slug || r.slug), data) };
  });
  const zonder = gekocht.filter((r) => !r.ing);

  const regelHtml = (it, x) => `<div class="ar-regel">
      <input type="number" min="0" step="any" inputmode="decimal" value="${x.hoeveelheid}" placeholder="genoeg" aria-label="Hoeveel">
      <select aria-label="Wat">${it.opties.map((o) => `<option value="${esc(o.waarde)}" ${o.waarde === x.waarde ? "selected" : ""}>${esc(o.tekst)}</option>`).join("")}</select>
      <button type="button" class="mini" data-regelweg aria-label="Weghalen" title="Weghalen">×</button>
    </div>`;
  const dlg = document.createElement("dialog");
  dlg.className = "dialoog";
  dlg.innerHTML = `<form novalidate>
    <h2 class="dl-kop">Klaar met winkelen</h2>
    <p class="hint">Klopt het? Pas aan wat je anders kocht, bijvoorbeeld een pot in plaats van een pak. Geen
      hoeveelheid = "in huis, genoeg". Vink uit wat je niet gekocht hebt: dat blijft op de lijst.</p>
    <ul class="afrekenen">${items.map((it, i) => `<li data-i="${i}">
      <label class="vink ar-naam"><input type="checkbox" data-mee checked> <b>${esc(it.r.naam)}</b></label>
      <div class="ar-regels">${it.regels.map((x) => regelHtml(it, x)).join("")}</div>
      <div class="ar-onder"><button type="button" class="linkknop" data-regel>+ nog iets</button>
        <select data-plek aria-label="Waar">${PLEKKEN.map(([p, n]) => `<option value="${p}" ${p === it.plek ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    </li>`).join("")}</ul>
    ${zonder.length ? `<p class="hint">Gaat ook van de lijst: ${esc(zonder.map((r) => r.naam).join(", "))}.</p>` : ""}
    <p class="fout" hidden></p>
    <div class="knoppen"><button class="knop primair" type="submit">In de voorraad</button>
      <button class="knop" type="button" data-annuleer>Annuleren</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form");
  const foutEl = dlg.querySelector(".fout");
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelector("[data-annuleer]").addEventListener("click", () => dlg.close());
  form.addEventListener("click", (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (!li) return;
    const it = items[li.dataset.i];
    if (ev.target.closest("[data-regel]")) {
      li.querySelector(".ar-regels").insertAdjacentHTML("beforeend", regelHtml(it, { waarde: it.opties[0].waarde, hoeveelheid: "" }));
    } else if (ev.target.closest("[data-regelweg]") && li.querySelectorAll(".ar-regel").length > 1) {
      ev.target.closest(".ar-regel").remove();
    }
  });
  form.addEventListener("change", (ev) => {
    const li = ev.target.closest("li[data-i]");
    if (li && ev.target.matches("[data-mee]")) li.classList.toggle("niet", !ev.target.checked);
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const knop = form.querySelector("[type=submit]");
    // Wat er gekocht is: [{r, plek, regels: [{optie, hoeveelheid|null}]}]
    const mee = [];
    for (const li of form.querySelectorAll("li[data-i]")) {
      if (!li.querySelector("[data-mee]").checked) continue;
      const it = items[li.dataset.i];
      const regels = [];
      for (const el of li.querySelectorAll(".ar-regel")) {
        const t = el.querySelector("input").value.trim();
        const h = t === "" ? null : Number(t.replace(",", "."));
        if (h != null && !(h > 0)) {
          foutEl.textContent = `${it.r.naam}: vul een hoeveelheid groter dan 0 in, of laat het leeg.`;
          foutEl.hidden = false;
          return;
        }
        regels.push({ optie: it.opties.find((o) => o.waarde === el.querySelector("select").value), hoeveelheid: h });
      }
      mee.push({ r: it.r, plek: li.querySelector("[data-plek]").value, regels });
    }
    knop.disabled = true;
    try {
      let d = data;
      const voorVoorraad = d.voorraad.ingredienten.map((p) => ({ ...p }));
      const voorLijst = { extra: d.boodschappen.extra.map((x) => ({ ...x })), afgevinkt: [...d.boodschappen.afgevinkt] };
      d = await wijzig("voorraad", (doc) => {
        for (const x of mee) {
          for (const { optie, hoeveelheid } of x.regels) {
            inVoorraad(doc.ingredienten, optie.slug, hoeveelheid == null ? [] : [{ hoeveelheid, eenheid: optie.eenheid }], d, vandaag(), x.plek);
          }
        }
      });
      // Van de lijst: wat gekocht is, en de extra's zonder ingrediënt. Afvinken begint opnieuw.
      const weg = new Set([...mee.map((x) => x.r.sleutel), ...zonder.map((r) => r.sleutel)]);
      d = await wijzig("boodschappen", (doc) => {
        doc.extra = doc.extra.filter((x) => !weg.has(sleutelExtra(x.id)));
        doc.afgevinkt = [];
        delete doc.gekocht;
      });
      dlg.close();
      melding(`${mee.length} ${mee.length === 1 ? "ding" : "dingen"} in de voorraad gezet`, async () => {
        await wijzig("voorraad", (doc) => { doc.ingredienten = voorVoorraad; });
        await wijzig("boodschappen", (doc) => { doc.extra = voorLijst.extra; doc.afgevinkt = voorLijst.afgevinkt; });
      });
      klaar(d);
    } catch (err) {
      foutEl.textContent = err.message;
      foutEl.hidden = false;
      knop.disabled = false;
    }
  });
  dlg.showModal();
}
