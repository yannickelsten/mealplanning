import { bewaarIngredient, laad } from "../store.js";
import { rekenIng, VOEDING_KEYS } from "../voeding.js";
import { esc, groepNaam, melding, nl, slugVan } from "../util.js";

const ROLLEN = ["eiwitbron", "peulvrucht", "groente", "fruit", "koolhydraat", "zuivel",
  "smaakmaker", "kruid", "vet", "snack", "overig"];
const f = { zoek: "", controleren: false };

function gebruik(data) {
  const m = {};
  for (const r of Object.values(data.recepten)) {
    const lijnen = [...(r.stappen || []).flatMap((s) => s.ingredienten || []),
      ...(r.keuzes?.opties || []).flatMap((o) => o.ingredienten || [])];
    for (const x of new Set(lijnen.map((l) => l.ingredient).filter(Boolean))) (m[x] ||= []).push(r);
  }
  return m;
}

// Varianten (merken) per algemene soort: {soort: [slug…]}
function variantenPer(data) {
  const m = {};
  for (const [s, i] of Object.entries(data.ingredienten)) if (i.soort) (m[i.soort] ||= []).push(s);
  return m;
}

const twijfel = (i) => i.controleren || (i.per_100g == null && !i.verwaarloosbaar);

export function ingredientenLijst(main, data) {
  const gebruikt = gebruik(data);
  const varianten = variantenPer(data);
  main.innerHTML = `
    <div class="kopregel"><h1 class="paginatitel">Ingrediënten</h1>
      <a class="knop" href="#/ingredient/nieuw">+ Nieuw ingrediënt</a></div>
    <div class="zoekbalk">
      <input type="search" id="zoek" placeholder="Zoek ingrediënt…" value="${esc(f.zoek)}" autocomplete="off">
      <label class="vink"><input type="checkbox" id="contr" ${f.controleren ? "checked" : ""}> alleen te controleren</label>
    </div>
    <div id="lijst"></div>`;
  const lijst = main.querySelector("#lijst");
  const opNaam = ([, a], [, b]) => a.naam.localeCompare(b.naam, "nl");
  const rijHtml = ([s, i], klasse = "") => {
    // Een algemene soort toont de waarden van zijn standaardmerk (grijs).
    const r = rekenIng(data.ingredienten, s);
    const geerfd = (veld) => i[veld] == null && r[veld] != null;
    const titel = i.standaard ? ` title="van ${esc(data.ingredienten[i.standaard]?.naam)}"` : "";
    const isStandaard = i.soort && data.ingredienten[i.soort]?.standaard === s;
    return `<tr data-slug="${esc(s)}"${klasse ? ` class="${klasse}"` : ""}>
      <td><a href="#/ingredient/${esc(s)}">${esc(i.naam)}</a>
        ${twijfel(r) ? `<span class="badge waarsch">controleren</span>` : ""}
        ${i.bron === "standaard" ? `<span class="badge">standaardwaarde</span>` : ""}
        ${varianten[s] ? `<span class="badge soort">${varianten[s].length} varianten</span>` : ""}
        ${isStandaard ? `<span class="badge" title="De algemene naam rekent met deze variant">standaard</span>` : ""}</td>
      ${VOEDING_KEYS.map((k) => `<td class="num${geerfd("per_100g") ? " geerfd" : ""}"${geerfd("per_100g") ? titel : ""}>${
        r.per_100g ? nl(r.per_100g[k], 1) : (r.verwaarloosbaar ? "–" : "?")}</td>`).join("")}
      <td class="num${geerfd("prijs_per_kg") ? " geerfd" : ""}">${r.prijs_per_kg != null ? nl(r.prijs_per_kg, 2) : ""}</td>
      <td class="num">${gebruikt[s]?.length || ""}</td></tr>`;
  };

  const toon = () => {
    const z = f.zoek.toLowerCase();
    const past = ([s, i]) => (!z || i.naam.toLowerCase().includes(z))
      && (!f.controleren || twijfel(rekenIng(data.ingredienten, s)));
    // Hoofdregels: alles wat geen variant is. Varianten komen eronder, op naam.
    // Past alleen een variant bij het zoeken, dan staat de algemene naam erboven (grijs).
    const blokken = Object.entries(data.ingredienten)
      .filter(([, i]) => !i.soort || !data.ingredienten[i.soort])
      .map(([s, i]) => {
        const kinderen = (varianten[s] || []).map((v) => [v, data.ingredienten[v]]).sort(opNaam);
        const zelf = past([s, i]);
        const zichtbaar = zelf ? kinderen : kinderen.filter(past);
        return zelf || zichtbaar.length ? { s, i, zelf, kinderen: zichtbaar } : null;
      })
      .filter(Boolean);
    const groepen = [...new Set(blokken.map((b) => b.i.groep))].sort((a, b) => a.localeCompare(b, "nl"));
    lijst.innerHTML = groepen.map((g) => `
      <section class="categorie"><h2>${esc(groepNaam(g))}</h2>
      <div class="tabel-wrap"><table class="tabel">
        <thead><tr><th>Naam</th><th>kcal</th><th>vet</th><th>kh</th><th>eiwit</th><th>€/kg</th><th>recepten</th></tr></thead>
        <tbody>${blokken.filter((b) => b.i.groep === g).sort((a, b) => opNaam([, a.i], [, b.i]))
          .map((b) => rijHtml([b.s, b.i], [b.kinderen.length ? "heeft-varianten" : "", b.zelf ? "" : "context"].filter(Boolean).join(" "))
            + b.kinderen.map((k, n) => rijHtml(k, `variant${n === b.kinderen.length - 1 ? " laatste" : ""}`)).join(""))
          .join("")}
        </tbody></table></div></section>`).join("")
      || `<p class="leeg-tekst">Geen ingrediënten gevonden.</p>`;
  };
  toon();
  main.querySelector("#zoek").addEventListener("input", (e) => { f.zoek = e.target.value; toon(); });
  main.querySelector("#contr").addEventListener("change", (e) => { f.controleren = e.target.checked; toon(); });
  lijst.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-slug]");
    if (tr && !e.target.closest("a")) location.hash = `#/ingredient/${tr.dataset.slug}`;
  });
}

const veld = (label, html, hint = "") =>
  `<label class="veld"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ""}</label>`;
const waarde = (v) => (v == null ? "" : esc(v));

export function ingredientForm(main, data, slug) {
  const nieuw = slug === "nieuw";
  const ing = nieuw ? { rol: "overig", groep: "", per_100g: null, prijs_per_kg: null } : data.ingredienten[slug];
  if (!ing) {
    main.innerHTML = `<p class="leeg-tekst">Ingrediënt niet gevonden. <a href="#/ingredienten">Terug</a></p>`;
    return;
  }
  const groepen = [...new Set(Object.values(data.ingredienten).map((i) => i.groep))].sort();
  const gebruikt = (gebruik(data)[slug] || []);
  const p = ing.per_100g || {};
  const verpakkingen = Object.keys(data.eenheden).filter((x) => data.eenheden[x].verpakking);
  const verpakking = Object.keys(ing.gram_per || {}).find((x) => data.eenheden[x]?.verpakking);
  const b = ing.bewaren || {};
  const groepAdvies = { ...data.bewaren.standaard, ...(data.bewaren.groepen[ing.groep] || {}) };
  const plekKeuze = (naam, gekozen, standaard) => `<select name="${naam}"><option value="">standaard (${standaard})</option>${
    ["koelkast", "vriezer", "kast"].map((x) => `<option ${x === gekozen ? "selected" : ""}>${x}</option>`).join("")}</select>`;

  // Soort en varianten: een algemene soort ("Tofu") heeft varianten ("Tofu (Jumbo)"…);
  // een variant hoort bij precies één soort. Eén niveau diep.
  const mijnVarianten = nieuw ? [] : (variantenPer(data)[slug] || []);
  const naamVan = (s) => data.ingredienten[s]?.naam || s;
  const std = ing.standaard && data.ingredienten[ing.standaard];
  const kandidaten = Object.entries(data.ingredienten)
    .filter(([s, i]) => s !== slug && !i.soort && (i.groep === ing.groep || s === ing.soort))
    .sort(([, a], [, b]) => a.naam.localeCompare(b.naam, "nl"));
  const soortVeld = mijnVarianten.length
    ? `<p class="hint">Varianten: ${mijnVarianten.map((s) => `<a href="#/ingredient/${esc(s)}">${esc(naamVan(s))}</a>`).join(", ")}.
         Op de boodschappenlijst en in de voorraad tellen ze samen als "${esc(ing.naam)}".</p>
       ${veld("Standaardvariant", `<select name="standaard"><option value="">geen (eigen waarden)</option>${mijnVarianten.map((s) =>
         `<option value="${esc(s)}" ${s === ing.standaard ? "selected" : ""}>${esc(naamVan(s))}</option>`).join("")}</select>`,
         "Recepten met deze algemene naam rekenen met de voedingswaarde, prijs en verpakking van deze variant (tenzij je hier zelf iets invult).")}`
    : veld("Variant van", `<select name="soort"><option value="">geen: zelfstandig product</option>${kandidaten.map(([s, i]) =>
        `<option value="${esc(s)}" ${s === ing.soort ? "selected" : ""}>${esc(i.naam)}</option>`).join("")}</select>`,
        "Kies dit als het hetzelfde product is van een ander merk of in een andere verpakking. Voorraad en boodschappenlijst tellen ze dan samen.");
  const geerfd = (k) => (std && ing.per_100g == null ? ` placeholder="${waarde(std.per_100g?.[k])}"` : "");

  main.innerHTML = `
    <a class="terug" href="#/ingredienten">← Ingrediënten</a>
    <h1 class="paginatitel">${nieuw ? "Nieuw ingrediënt" : esc(ing.naam)}</h1>
    <form class="formulier" novalidate>
      <fieldset><legend>Algemeen</legend>
        ${veld("Naam *", `<input name="naam" required value="${waarde(ing.naam)}">`,
          nieuw ? `Code: <code id="slug">–</code>` : `Code: <code>${esc(slug)}</code>`)}
        ${veld("Groep *", `<input name="groep" list="groepen" required value="${waarde(ing.groep)}">
          <datalist id="groepen">${groepen.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>`)}
        ${veld("Rol *", `<select name="rol">${ROLLEN.map((r) => `<option ${r === ing.rol ? "selected" : ""}>${r}</option>`).join("")}</select>`)}
        ${veld("Filterlabel", `<input name="tag" value="${waarde(ing.tag)}">`, "bv. 'kip' of 'tofu', voor het filteren van recepten")}
      </fieldset>
      <fieldset><legend>Soort en varianten</legend>
        ${soortVeld}
      </fieldset>
      <fieldset><legend>Voedingswaarde per 100 g</legend>
        <div class="vier">
          ${veld("kcal", `<input name="kcal" type="number" step="any" min="0" value="${waarde(p.kcal)}"${geerfd("kcal")}>`)}
          ${veld("vet (g)", `<input name="vet" type="number" step="any" min="0" value="${waarde(p.vet)}"${geerfd("vet")}>`)}
          ${veld("koolhydraten (g)", `<input name="koolhydraten" type="number" step="any" min="0" value="${waarde(p.koolhydraten)}"${geerfd("koolhydraten")}>`)}
          ${veld("eiwit (g)", `<input name="eiwit" type="number" step="any" min="0" value="${waarde(p.eiwit)}"${geerfd("eiwit")}>`)}
        </div>
        ${std && ing.per_100g == null ? `<p class="hint">Leeg = de waarden van ${esc(std.naam)} (standaardvariant).</p>` : ""}
      </fieldset>
      <fieldset><legend>Prijs en omrekenen</legend>
        <div class="vier">
          ${veld("Prijs (€/kg of €/l)", `<input name="prijs_per_kg" type="number" step="any" min="0" value="${waarde(ing.prijs_per_kg)}">`)}
          ${veld("Gram per stuk", `<input name="stuk" type="number" step="any" min="0" value="${waarde(ing.gram_per?.stuk)}">`, "bv. 1 ui = 100")}
          ${veld("Dichtheid (g/ml)", `<input name="dichtheid" type="number" step="any" min="0" value="${waarde(ing.dichtheid)}">`, "alleen als niet ±1, bv. olie 0,92")}
        </div>
      </fieldset>
      <fieldset><legend>Verpakking en bewaren</legend>
        <div class="vier">
          ${veld("Verpakking", `<select name="verpakking"><option value="">geen</option>${verpakkingen.map((x) =>
            `<option ${x === verpakking ? "selected" : ""}>${x}</option>`).join("")}</select>`, "zo koop je het, bv. blok")}
          ${veld("Gram per verpakking", `<input name="verpakking_g" type="number" step="any" min="0" value="${waarde(verpakking && ing.gram_per[verpakking])}">`, `bv. 500<span data-stuks></span>`)}
        </div>
        <label class="vink"><input type="checkbox" name="per_stuk" ${ing.per_stuk ? "checked" : ""}> per stuk: je koopt een zak, net
          of bol, maar pakt er losse stuks uit (uien, citroenen, knoflook, aardappelen). Wat je eruit haalt
          maakt de rest niet "open": die blijft heel en even lang goed.</label>
        ${veld("Naam van één stuk", `<input name="stuknaam" value="${waarde(ing.stuknaam?.join(" / "))}" placeholder="bv. teentje / teentjes">`,
          "alleen als 'stuks' niet duidelijk is, zoals bij knoflook (enkelvoud / meervoud)")}
        <div class="vier">
          ${veld("Bewaren in", plekKeuze("b_plek", b.plek, groepAdvies.plek))}
          ${veld("Dicht houdbaar (dagen)", `<input name="b_dagen" type="number" step="1" min="1" value="${waarde(b.dagen)}" placeholder="${groepAdvies.dagen}">`)}
          ${veld("Na openen (dagen)", `<input name="b_open" type="number" step="1" min="1" value="${waarde(b.open)}" placeholder="${groepAdvies.open}">`)}
          ${veld("Na openen in", plekKeuze("b_open_plek", b.open_plek, groepAdvies.open_plek))}
        </div>
        <p class="hint">Leeg = het advies voor de groep. De app rekent hiermee uit wanneer iets op moet,
          zodat je geen datums hoeft over te typen.</p>
      </fieldset>
      <fieldset><legend>Kenmerken</legend>
        <label class="vink"><input type="checkbox" name="vlees" ${ing.vlees ? "checked" : ""}> vlees of vis (niet vegetarisch)</label>
        <label class="vink"><input type="checkbox" name="verwaarloosbaar" ${ing.verwaarloosbaar ? "checked" : ""}> verwaarloosbaar (kruiden, zout: telt niet mee)</label>
        <label class="vink"><input type="checkbox" name="controleren" ${ing.controleren ? "checked" : ""}> nog controleren</label>
        ${ing.bron ? `<p class="hint">Bron: ${esc(ing.bron)}</p>` : ""}
      </fieldset>
      <p class="fout" hidden></p>
      <div class="knoppen"><button class="knop primair" type="submit">Opslaan</button>
        <a class="knop" href="#/ingredienten">Annuleren</a></div>
    </form>
    ${gebruikt.length ? `<section class="meta"><span class="label">Gebruikt in</span><ul>${gebruikt
      .map((r) => `<li><a href="#/recept/${esc(r.id)}">${esc(r.titel)}</a></li>`).join("")}</ul></section>` : ""}`;

  const form = main.querySelector("form");
  const foutEl = form.querySelector(".fout");
  const slugEl = form.querySelector("#slug");
  if (slugEl) form.naam.addEventListener("input", () => { slugEl.textContent = slugVan(form.naam.value) || "–"; });
  // Hoeveel stuks er in een verpakking zitten: "= ±10 stuks".
  const stuksEl = form.querySelector("[data-stuks]");
  const stuksTonen = () => {
    const n = Number(form.verpakking_g.value) / Number(form.stuk.value);
    stuksEl.textContent = form.verpakking.value && n > 0 && Number.isFinite(n) ? ` · = ±${nl(Math.round(n * 4) / 4)} stuks` : "";
  };
  for (const v of ["verpakking", "verpakking_g", "stuk"]) form[v].addEventListener("input", stuksTonen);
  stuksTonen();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const getal = (n) => (form[n].value.trim() === "" ? null : Number(form[n].value));
    const fout = (t) => { foutEl.textContent = t; foutEl.hidden = false; };
    const naam = form.naam.value.trim();
    const nieuweSlug = nieuw ? slugVan(naam) : slug;
    if (!naam || !form.groep.value.trim()) return fout("Naam en groep zijn verplicht.");
    if (nieuw && data.ingredienten[nieuweSlug]) return fout(`Er bestaat al een ingrediënt met code '${nieuweSlug}'.`);
    const voeding = Object.fromEntries(VOEDING_KEYS.map((k) => [k, getal(k)]));
    const ingevuld = Object.values(voeding).filter((v) => v != null).length;
    if (ingevuld && ingevuld < 4) return fout("Vul alle vier de voedingswaarden in, of geen enkele.");

    const uit = { ...ing, naam, groep: slugVan(form.groep.value) || form.groep.value.trim(), rol: form.rol.value };
    uit.per_100g = ingevuld ? voeding : null;
    // Zelf de voedingswaarden aangepast? Dan is het geen geschatte standaardwaarde meer.
    const oud = ing.per_100g;
    if (ingevuld && (!oud || VOEDING_KEYS.some((k) => voeding[k] !== oud[k]))) uit.bron = "handmatig";
    if (form.soort) { if (form.soort.value) uit.soort = form.soort.value; else delete uit.soort; }
    if (form.standaard) { if (form.standaard.value) uit.standaard = form.standaard.value; else delete uit.standaard; }
    uit.prijs_per_kg = getal("prijs_per_kg");
    const gp = { ...(ing.gram_per || {}) };
    if (getal("stuk") != null) gp.stuk = getal("stuk"); else delete gp.stuk;
    for (const x of verpakkingen) delete gp[x];
    if (form.verpakking.value) {
      if (!(getal("verpakking_g") > 0)) return fout(`Vul in hoeveel gram één ${form.verpakking.value} weegt.`);
      gp[form.verpakking.value] = getal("verpakking_g");
    }
    if (Object.keys(gp).length) uit.gram_per = gp; else delete uit.gram_per;
    // inhoud (gram per verpakking voor de "bijna op"-schatting) staat niet in het formulier: bewaren.
    const bewaar = Object.fromEntries([["plek", form.b_plek.value || null], ["dagen", getal("b_dagen")],
      ["open", getal("b_open")], ["open_plek", form.b_open_plek.value || null], ["inhoud", b.inhoud ?? null]]
      .filter(([, v]) => v != null));
    if (Object.keys(bewaar).length) uit.bewaren = bewaar; else delete uit.bewaren;
    // "teentje / teentjes"; zonder meervoud: + s.
    const sn = form.stuknaam.value.split("/").map((x) => x.trim()).filter(Boolean);
    const opt = { tag: form.tag.value.trim() || null, dichtheid: getal("dichtheid"),
      vlees: form.vlees.checked || null, verwaarloosbaar: form.verwaarloosbaar.checked || null,
      controleren: form.controleren.checked || null, per_stuk: form.per_stuk.checked || null,
      stuknaam: sn.length ? [sn[0], sn[1] || `${sn[0]}s`] : null };
    for (const [k, v] of Object.entries(opt)) { if (v == null) delete uit[k]; else uit[k] = v; }
    if (nieuw) uit.bron = "handmatig";

    try {
      await bewaarIngredient(nieuweSlug, uit);
      await laad(true);
      melding("Opgeslagen");
      location.hash = "#/ingredienten";
    } catch (err) {
      fout(err.message);
    }
  });
}
