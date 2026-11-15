import { afgeleideTags, regels, voeding } from "../voeding.js";
import { datumNl, esc, nl } from "../util.js";
import { recentGewijzigd } from "./recept.js";

// Filters blijven bewaard zolang de pagina open is.
const f = {
  zoek: "", categorie: "alle", vegetarisch: false,
  eiwit: new Set(), groente: new Set(), keuken: new Set(), vibe: new Set(),
};
const KEUZES = [["eiwit", "Eiwit"], ["groente", "Groente"], ["keuken", "Keuken"], ["vibe", "Vibe"]];

// Een open keuzelijst sluit bij klikken ernaast of met Escape (één keer instellen).
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.dropdown[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll("details.dropdown[open]").forEach((d) => { d.open = false; });
});

function info(recept, data) {
  const t = voeding(recept, data);
  const tags = afgeleideTags(recept, data);
  const namen = [...regels(recept)].map((r) => r.naam || "").join(" ");
  return {
    recept, t, tags,
    zoektekst: `${recept.titel} ${recept.ondertitel || ""} ${namen}`.toLowerCase(),
  };
}

// De waarden van een recept voor een keuzelijst.
const waardenVan = (i, naam) =>
  naam === "eiwit" ? i.tags.eiwit : naam === "groente" ? i.tags.groente : i.recept.tags?.[naam] || [];

const heeftEen = (set, lijst) => !set.size || lijst.some((x) => set.has(x));

function past(i) {
  return (!f.zoek || i.zoektekst.includes(f.zoek.toLowerCase()))
    && (f.categorie === "alle" || i.recept.categorie === f.categorie)
    && (!f.vegetarisch || i.tags.vegetarisch)
    && KEUZES.every(([naam]) => heeftEen(f[naam], waardenVan(i, naam)));
}

// Keuzelijst met vinkjes; het getal is het aantal recepten met die waarde.
function dropdown(naam, label, alle) {
  const telling = {};
  for (const i of alle) for (const w of waardenVan(i, naam)) telling[w] = (telling[w] || 0) + 1;
  const waarden = Object.keys(telling).sort((a, b) => a.localeCompare(b, "nl"));
  if (!waarden.length) return "";
  return `<details class="dropdown" data-filter="${naam}">
    <summary class="knop klein">${label}<span class="d-aantal">${f[naam].size ? ` · ${f[naam].size}` : ""}</span></summary>
    <div class="dropdown-paneel">${waarden.map((w) => `<label class="vink">
      <input type="checkbox" value="${esc(w)}" ${f[naam].has(w) ? "checked" : ""}> ${esc(w)} <small>${telling[w]}</small></label>`).join("")}
    </div></details>`;
}

function kaartje(i) {
  const r = i.recept;
  const p = r.porties || (r.opbrengst_g ? r.opbrengst_g / 100 : 1);
  const label = r.porties ? "per portie" : r.opbrengst_g ? "per 100 g" : "totaal";
  const recent = recentGewijzigd(r) || (i.nieuweVariant ? "nieuwe variant" : null);
  return `<a class="receptkaart" href="#/recept/${esc(r.id)}">
    ${recent ? `<span class="badge nieuw">${recent}</span>` : ""}
    <span class="rk-titel">${esc(r.titel)}</span>
    ${r.ondertitel ? `<span class="rk-onder">${esc(r.ondertitel)}</span>` : ""}
    <span class="rk-cijfers">${nl(i.t.kcal / p)} kcal · ${nl(i.t.eiwit / p)}g eiwit <small>${label}</small></span>
    <span class="rk-tags">${[...i.tags.eiwit, ...(i.tags.vegetarisch ? ["vega"] : [])]
      .map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
  </a>`;
}

export function overzicht(main, data) {
  const alle = Object.values(data.recepten)
    .filter((r) => !r.variant_van)
    .map((r) => ({ ...info(r, data),
      nieuweVariant: Object.values(data.recepten).some((v) => v.variant_van === r.id && recentGewijzigd(v) === "nieuw") }));
  const cats = data.categorieen.filter((c) => alle.some((i) => i.recept.categorie === c.id));
  const catNaam = (id) => cats.find((c) => c.id === id)?.naam || id;

  // Recent toegevoegd of aangepast (in de app, of door Claude in de map gezet).
  const recent = Object.values(data.recepten).filter((r) => recentGewijzigd(r))
    .sort((a, b) => b.wijzigingen.at(-1).datum.localeCompare(a.wijzigingen.at(-1).datum)).slice(0, 6);

  main.innerHTML = `
    <div class="kopregel"><h1 class="paginatitel">Recepten</h1>
      <a class="knop alleen-laptop" href="#/nieuw-recept">+ Nieuw recept</a></div>
    ${recent.length ? `<section class="recent"><span class="label">Recent toegevoegd of aangepast</span>
      <ul>${recent.map((r) => `<li><a href="#/recept/${esc(r.id)}">${esc(r.titel)}${r.variant_van && r.ondertitel ? ` <small>(${esc(r.ondertitel)})</small>` : ""}</a>
        <span class="badge nieuw">${recentGewijzigd(r)}</span>
        <small>${esc(datumNl(r.wijzigingen.at(-1).datum))}: ${esc(r.wijzigingen.at(-1).wat)}</small></li>`).join("")}</ul></section>` : ""}
    <div class="zoekbalk">
      <input type="search" id="zoek" placeholder="Zoek recept of ingrediënt…" value="${esc(f.zoek)}" autocomplete="off">
    </div>
    <div class="filterbalk">
      <select id="categorie" class="filterkeuze" aria-label="Categorie">
        <option value="alle">Alle categorieën</option>
        ${cats.map((c) => `<option value="${esc(c.id)}" ${f.categorie === c.id ? "selected" : ""}>${esc(c.naam)}</option>`).join("")}
      </select>
      ${KEUZES.map(([naam, label]) => dropdown(naam, label, alle)).join("")}
      <label class="vink filtervink"><input type="checkbox" id="veg" ${f.vegetarisch ? "checked" : ""}> Vegetarisch</label>
    </div>
    <div class="actief"></div>
    <div id="lijst"></div>`;

  const lijst = main.querySelector("#lijst");
  const actief = main.querySelector(".actief");

  // Gekozen filters als chips met ×, plus het aantal recepten.
  const toonActief = (aantal) => {
    const chips = [
      ...(f.categorie !== "alle" ? [["categorie", f.categorie, catNaam(f.categorie)]] : []),
      ...KEUZES.flatMap(([naam]) => [...f[naam]].map((w) => [naam, w, w])),
      ...(f.vegetarisch ? [["veg", "", "vegetarisch"]] : []),
    ];
    actief.innerHTML = `<span class="hint">${aantal} ${aantal === 1 ? "recept" : "recepten"}</span>
      ${chips.map(([soort, w, tekst]) => `<button class="chip aan" data-soort="${soort}" data-waarde="${esc(w)}"
        aria-label="Filter ${esc(tekst)} weghalen">${esc(tekst)} ×</button>`).join("")}
      ${chips.length > 1 ? `<button class="chip leeg" data-wis>Alles wissen</button>` : ""}`;
  };

  const toon = () => {
    const zichtbaar = alle.filter(past);
    toonActief(zichtbaar.length);
    if (!zichtbaar.length) {
      lijst.innerHTML = `<p class="leeg-tekst">Geen recepten gevonden met deze filters.</p>`;
      return;
    }
    lijst.innerHTML = data.categorieen.map((c) => {
      const items = zichtbaar.filter((i) => i.recept.categorie === c.id)
        .sort((a, b) => a.recept.titel.localeCompare(b.recept.titel, "nl"));
      if (!items.length) return "";
      return `<section class="categorie"><h2>${esc(c.naam)} <small>${items.length}</small></h2>
        <div class="raster">${items.map(kaartje).join("")}</div></section>`;
    }).join("");
  };
  toon();

  main.querySelector("#zoek").addEventListener("input", (e) => { f.zoek = e.target.value; toon(); });
  main.querySelector("#categorie").addEventListener("change", (e) => { f.categorie = e.target.value; toon(); });
  main.querySelector("#veg").addEventListener("change", (e) => { f.vegetarisch = e.target.checked; toon(); });

  // Vinkjes in een keuzelijst: de lijst blijft open, alleen de recepten en het getal veranderen.
  main.querySelectorAll("details.dropdown").forEach((d) => {
    const set = f[d.dataset.filter];
    d.addEventListener("change", (e) => {
      if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
      d.querySelector(".d-aantal").textContent = set.size ? ` · ${set.size}` : "";
      toon();
    });
    // Er is er maar één tegelijk open.
    d.addEventListener("toggle", () => {
      if (d.open) main.querySelectorAll("details.dropdown[open]").forEach((x) => { if (x !== d) x.open = false; });
    });
  });

  actief.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if ("wis" in b.dataset) {
      f.categorie = "alle"; f.vegetarisch = false;
      KEUZES.forEach(([naam]) => f[naam].clear());
    } else if (b.dataset.soort === "categorie") f.categorie = "alle";
    else if (b.dataset.soort === "veg") f.vegetarisch = false;
    else f[b.dataset.soort].delete(b.dataset.waarde);
    overzicht(main, data); // keuzelijsten bijwerken
  });
}
