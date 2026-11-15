import { wijzig } from "../store.js";
import { boodschappenlijst, inVerpakkingen, inVoorraad, prijsVan, rond, sleutelExtra, soortVan, standaardPlek, teKoken,
  toonHoeveelheid, toonPartijen, verpakkingVan, voorraadEenheden } from "../planning.js";
import { breuk, datumNl, esc, euro, groepNaam, melding, nieuwId, nl, vandaag } from "../util.js";
import { ingredientKeuzelijst, vindIngredient } from "./voorraad.js";

const fout = (err) => melding(err.message);

// Ongeveer de looproute door de supermarkt; onbekende groepen komen daarna.
const ROUTE = ["fruit-en-groente", "brood", "vlees-en-vleesvervangers", "zuivel-en-kaas", "pasta-en-rijst",
  "conserven-en-peulvruchten", "sauzen-en-smaakmakers", "kruiden-en-specerijen", "olie-en-vet",
  "ontbijt-en-bakken", "snacks", "diepvries", "overig"];
const ZONDER_GROEP = "~extra";
const groepTitel = (g) => (g === ZONDER_GROEP ? "Overig" : groepNaam(g));
const volgorde = (g) => (g === ZONDER_GROEP ? 999 : ROUTE.indexOf(g) === -1 ? 500 : ROUTE.indexOf(g));

export function boodschappen(main, data) {
  const herteken = (d) => boodschappen(main, d);
  const lijst = boodschappenlijst(data);
  const af = new Set(data.boodschappen.afgevinkt);
  const gerechten = teKoken(data);
  const e = data.eenheden;
  // Zelf aangepaste hoeveelheid bij iets dat afgevinkt is ("2 potten gekocht in plaats van 1").
  const aangepast = (sleutel) => {
    const q = af.has(sleutel) && data.boodschappen.gekocht?.[sleutel];
    return q ? [q] : null;
  };

  // Alles wat je moet kopen: uit de recepten, plus wat je zelf hebt toegevoegd.
  const rijen = [
    ...lijst.filter((x) => x.status === "kopen").map((x) => {
      // In hele verpakkingen als het ingrediënt een verpakking heeft: "2 blokken (1kg nodig)".
      let pak = inVerpakkingen(x.rest, x.ing, e);
      // Op en verder niets nodig: één verpakking (als bekend is hoe je het koopt).
      const alleenOp = x.opgemaakt && !x.rest.length;
      if (alleenOp && verpakkingVan(x.ing, e)) pak = { hoeveelheid: 1, eenheid: verpakkingVan(x.ing, e)[0] };
      const standaard = pak ? [pak] : x.rest;
      const gekocht = aangepast(x.sleutel) || standaard;
      const waarom = [
        x.recepten.size && [...x.recepten].join(", "),
        x.minimum && `vaste voorraad: minstens ${toonHoeveelheid([x.minimum], e, x.ing)}`,
        x.bijnaOp != null && `naar schatting ±${nl(Math.min(100, Math.round(x.bijnaOp * 10) * 10))}% gebruikt`,
        x.opgemaakt && `op sinds ${datumNl(x.opgemaakt)}`,
      ].filter(Boolean).join(" · ");
      return {
        sleutel: x.sleutel, slug: x.slug, ing: x.ing, naam: x.ing.naam, groep: x.ing.groep, gekocht, standaard,
        later: x.later, prijs: prijsVan(gekocht, x.ing, e), bijnaOp: x.bijnaOp != null, alleenOp,
        hv: x.bijnaOp != null ? "bijna op?" : alleenOp ? (pak ? toonHoeveelheid([pak], e) : "is op")
          : pak ? `${toonHoeveelheid([pak], e)} (${toonHoeveelheid(x.rest, e, x.ing)} nodig)` : toonHoeveelheid(x.rest, e, x.ing),
        detail: waarom
          + (x.later ? ` · nodig op ${datumNl(x.dag)}, koop vanaf ${datumNl(x.later)}` : "")
          + (x.partijen.length && x.bijnaOp == null ? ` · in huis: ${toonPartijen(x.partijen, data)}` : ""),
      };
    }),
    ...data.boodschappen.extra.map((x) => {
      const ing = data.ingredienten[x.ingredient];
      const gekocht = aangepast(sleutelExtra(x.id)) || [];
      return { sleutel: sleutelExtra(x.id), extraId: x.id, slug: ing ? x.ingredient : null, ing,
        naam: x.naam, groep: ing?.groep || ZONDER_GROEP, gekocht, standaard: [], hv: "", detail: "",
        prijs: ing ? prijsVan(gekocht, ing, e) : null };
    }),
  ];
  const inHuis = lijst.filter((x) => x.status !== "kopen");
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

  // Bij een afgevinkt ingrediënt: hoeveel je echt gekocht hebt (gaat zo de voorraad in).
  // Leeg = wat er op de lijst stond (of "genoeg in huis" als daar geen hoeveelheid bij stond).
  const aantalHtml = (r) => {
    const q = r.gekocht.length === 1 ? r.gekocht[0] : null;
    const eenheid = q?.eenheid || verpakkingVan(r.ing, e)?.[0] || (r.ing.gram_per?.stuk || r.ing.per_stuk ? "stuk" : "g");
    const opties = voorraadEenheden(e).filter((u) => u === eenheid || ["g", "kg", "ml", "l"].includes(u)
      || r.ing.gram_per?.[u] != null || (u === "stuk" && r.ing.per_stuk));
    const leeg = r.standaard.length ? toonHoeveelheid(r.standaard, e, r.ing) : "genoeg";
    return `<span class="b-aantal">gekocht:
      <button type="button" class="stapper" data-aantal="-1" aria-label="Minder">−</button>
      <input type="number" min="0" step="any" inputmode="decimal" value="${q ? rond(q.hoeveelheid, q.eenheid, e) : ""}" placeholder="${esc(leeg)}" aria-label="Hoeveel gekocht">
      <button type="button" class="stapper" data-aantal="1" aria-label="Meer">+</button>
      <select aria-label="Eenheid">${opties.map((u) => `<option ${u === eenheid ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
      ${data.boodschappen.gekocht?.[r.sleutel] ? `<small>aangepast</small>` : ""}
    </span>`;
  };

  const rijHtml = (r) => `<li class="b-item${af.has(r.sleutel) ? " af" : ""}" data-sleutel="${esc(r.sleutel)}">
    <label class="b-vink"><input type="checkbox" ${af.has(r.sleutel) ? "checked" : ""}>
      <span class="b-naam">${esc(r.naam)}</span>${r.hv ? ` <span class="b-hv">${esc(r.hv)}</span>` : ""}</label>
    ${r.prijs != null ? `<span class="b-prijs">±${esc(euro(r.prijs))}</span>` : ""}
    ${r.detail ? `<small class="b-detail">${esc(r.detail)}</small>` : ""}
    ${af.has(r.sleutel) && r.ing ? aantalHtml(r) : ""}
    <span class="b-acties">
      ${r.bijnaOp ? `<button class="knop klein" data-genoeg title="Er is nog genoeg: de app begint opnieuw met tellen">nog genoeg</button>`
        : r.alleenOp ? `<button class="knop klein" data-nietnodig title="Niet opnieuw kopen">niet nodig</button>`
        : r.slug && !r.extraId ? `<button class="knop klein" data-heb title="Staat in de voorraad als 'genoeg in huis'">heb ik al</button>` : ""}
      ${r.extraId ? `<button class="kruisje" data-extraweg aria-label="Weghalen" title="Weghalen">×</button>` : ""}
    </span></li>`;

  main.innerHTML = `
    <div class="kopregel"><h1 class="paginatitel">Boodschappen</h1>
      ${rijen.length ? `<button class="knop" id="kopieer">Lijst kopiëren</button>` : ""}</div>
    <p class="voor">${gerechten.length
      ? `Voor: ${gerechten.map((g) => `<a href="#/recept/${esc(g.recept)}">${esc(data.recepten[g.recept].titel)}</a> <small>(${g.porties}${g.dag ? `, ${esc(datumNl(g.dag))}` : ""})</small>`).join(", ")}
        · <a href="#/menu">menu aanpassen</a>`
      : `Er staat nog niets op het menu. <a href="#/menu">Kies wat je gaat eten</a>, dan komen de ingrediënten hier vanzelf.`}</p>
    ${onderdelen.size ? `<p class="hint">Al gemaakt, uit de koelkast/vriezer: ${[...onderdelen].map(([id, keer]) =>
      `${esc(data.recepten[id]?.titel || id)} (${breuk(keer)}×)`).join(", ")}. Daarvoor hoef je niets te kopen.</p>` : ""}
    ${metPrijs.length ? `<p class="b-totaal">Geschat: <b>±${esc(euro(totaal))}</b>${zonderPrijs ? ` <small>(+ ${zonderPrijs} zonder prijs)</small>` : ""}</p>` : ""}
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
    ${aantalAf ? `<div class="knoppen b-klaar"><button class="knop primair" id="naar-voorraad">Klaar met winkelen: ${aantalAf} afgevinkt in de voorraad zetten</button></div>` : ""}
    ${inHuis.length ? `<details class="b-inhuis"><summary>Al in huis (${inHuis.length})</summary>
      <ul class="blijst">${inHuis.sort((a, b) => a.ing.naam.localeCompare(b.ing.naam, "nl")).map((x) => `<li class="b-item">
        <span class="b-naam">${esc(x.ing.naam)}</span>
        <small class="b-detail">${x.nodig.length ? `nodig ${esc(toonHoeveelheid(x.nodig, e, x.ing))} · ` : ""}in huis${x.partijen.some((p) => p.hoeveelheid != null)
          ? `: ${esc(toonPartijen(x.partijen.filter((p) => p.hoeveelheid != null), data))}` : ""}${x.status === "onzeker" ? " (genoeg?)" : ""}</small>
      </li>`).join("")}</ul>
      <p class="hint">Klopt iets niet? Pas het aan bij <a href="#/voorraad">Voorraad</a>.</p></details>` : ""}`;

  // Afvinken
  const huidige = new Set(rijen.map((r) => r.sleutel));
  main.querySelectorAll(".blijst input[type=checkbox]").forEach((cb) => cb.addEventListener("change", () => {
    const sleutel = cb.closest("li").dataset.sleutel;
    cb.closest("li").classList.toggle("af", cb.checked);
    wijzig("boodschappen", (doc) => {
      const s = new Set(doc.afgevinkt.filter((k) => huidige.has(k)));
      if (cb.checked) s.add(sleutel); else s.delete(sleutel);
      doc.afgevinkt = [...s];
      // Aangepaste hoeveelheden alleen bij wat (nog) afgevinkt is.
      if (doc.gekocht) {
        for (const k of Object.keys(doc.gekocht)) if (!s.has(k)) delete doc.gekocht[k];
        if (!Object.keys(doc.gekocht).length) delete doc.gekocht;
      }
    }).then(herteken, fout);
  }));

  // Hoeveelheid gekocht aanpassen. Gelijk aan wat op de lijst stond = niet aangepast.
  main.querySelectorAll(".b-aantal").forEach((el) => {
    const sleutel = el.closest("li").dataset.sleutel;
    const r = rijen.find((x) => x.sleutel === sleutel);
    const invoer = el.querySelector("input");
    const keuze = el.querySelector("select");
    const bewaar = () => {
      const hv = invoer.value === "" ? null : Number(invoer.value.replace(",", "."));
      const q = hv > 0 ? { hoeveelheid: hv, eenheid: keuze.value } : null;
      const zoalsLijst = q && r.standaard.length === 1 && r.standaard[0].eenheid === q.eenheid
        && Math.abs(r.standaard[0].hoeveelheid - q.hoeveelheid) < 1e-6;
      wijzig("boodschappen", (doc) => {
        doc.gekocht ||= {};
        if (q && !zoalsLijst) doc.gekocht[sleutel] = q; else delete doc.gekocht[sleutel];
        if (!Object.keys(doc.gekocht).length) delete doc.gekocht;
      }).then(herteken, fout);
    };
    // Stapjes: hele stuks/verpakkingen, 50 g/ml, of een halve kg/l.
    const stap = () => ({ g: 50, ml: 50, kg: 0.5, l: 0.5 })[keuze.value] || 1;
    el.querySelectorAll("[data-aantal]").forEach((b) => b.addEventListener("click", () => {
      const nu = Number(invoer.value.replace(",", ".")) || 0;
      invoer.value = Math.max(0, Math.round((nu + Number(b.dataset.aantal) * stap()) * 100) / 100) || "";
      bewaar();
    }));
    invoer.addEventListener("change", bewaar);
    keuze.addEventListener("change", bewaar);
  });

  // "heb ik al": in de voorraad als genoeg in huis
  main.querySelectorAll("[data-heb]").forEach((b) => b.addEventListener("click", () => {
    const r = rijen.find((x) => x.sleutel === b.closest("li").dataset.sleutel);
    wijzig("voorraad", (doc) => {
      // Een partij zonder hoeveelheid = "genoeg in huis".
      if (!doc.ingredienten.some((p) => soortVan(data, p.ingredient) === r.slug && p.hoeveelheid == null)) {
        // Met datum: vanaf vandaag telt de app hoeveel je ervan gebruikt.
        doc.ingredienten.push({ id: nieuwId(), ingredient: r.slug, plek: standaardPlek(r.ing, data), gekocht: vandaag() });
      }
    }).then((d) => { melding(`${r.naam} staat in de voorraad`); herteken(d); }, fout);
  }));

  // "nog genoeg": de schatting klopte niet; vanaf vandaag opnieuw tellen.
  main.querySelectorAll("[data-genoeg]").forEach((b) => b.addEventListener("click", () => {
    const r = rijen.find((x) => x.sleutel === b.closest("li").dataset.sleutel);
    const vanSoort = (p) => soortVan(data, p.ingredient) === r.slug && p.hoeveelheid == null;
    const voor = data.voorraad.ingredienten.filter(vanSoort).map((p) => ({ ...p }));
    wijzig("voorraad", (doc) => {
      for (const p of doc.ingredienten.filter(vanSoort)) p.geteld = vandaag();
    }).then((d) => {
      melding(`${r.naam}: de app vraagt het later opnieuw`, () => wijzig("voorraad", (doc) => {
        doc.ingredienten = [...doc.ingredienten.filter((p) => !vanSoort(p)), ...voor];
      }));
      herteken(d);
    }, fout);
  }));

  // "niet nodig" bij iets dat op is: niet meer voorstellen (de regel in het logboek blijft).
  main.querySelectorAll("[data-nietnodig]").forEach((b) => b.addEventListener("click", () => {
    const r = rijen.find((x) => x.sleutel === b.closest("li").dataset.sleutel);
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

  // Na het winkelen: afgevinkte ingrediënten in de voorraad, afgevinkte extra's weg.
  main.querySelector("#naar-voorraad")?.addEventListener("click", async () => {
    const gekocht = rijen.filter((r) => af.has(r.sleutel));
    try {
      let d = await wijzig("voorraad", (doc) => {
        for (const r of gekocht) if (r.slug) inVoorraad(doc.ingredienten, r.slug, r.gekocht, data);
      });
      d = await wijzig("boodschappen", (doc) => {
        const weg = new Set(gekocht.map((r) => r.sleutel));
        doc.extra = doc.extra.filter((x) => !weg.has(sleutelExtra(x.id)));
        doc.afgevinkt = [];
        delete doc.gekocht;
      });
      melding("In de voorraad gezet");
      herteken(d);
    } catch (err) {
      fout(err);
    }
  });

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
