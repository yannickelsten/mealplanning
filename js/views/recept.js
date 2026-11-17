import { wijzig } from "../store.js";
import { afgeleideTags, rekenIng, voeding } from "../voeding.js";
import { dagenTot, datumNl, esc, euro, geleden, hoeveelheid, melding, nieuwId, nl } from "../util.js";
import { kookbeurtOpMenu, zelfGegeten } from "../planning.js";
import { gekookt } from "./gekookt.js";

// Gekozen porties en keuze per recept, zolang de pagina open is (ook gebruikt door de kookstand).
const staat = {};
export const receptStaat = (id, r) =>
  (staat[id] ||= { porties: r.porties || 1, keuze: r.keuzes?.opties?.[0]?.id });

// Recent toegevoegd of aangepast (bv. door Claude)? "nieuw", "aangepast" of null.
// De eerste grote import uit Canva (14-15 nov 2026) telt niet als nieuw.
const EERSTE_IMPORT = "2026-11-15";
export function recentGewijzigd(r, dagen = 7) {
  const w = r.wijzigingen || [];
  const laatst = w.at(-1);
  if (!laatst || -dagenTot(laatst.datum) > dagen) return null;
  if (laatst.datum <= EERSTE_IMPORT && /^Geïmporteerd uit Canva/.test(laatst.wat)) return null;
  return w.length === 1 ? "nieuw" : "aangepast";
}

function regelHtml(regel, data, factor, attrs = "") {
  const ing = data.ingredienten[regel.ingredient];
  const naam = esc(regel.naam || ing?.naam || regel.recept || "");
  let naamHtml = naam;
  if (regel.recept && data.recepten[regel.recept]) {
    naamHtml = `<a href="#/recept/${esc(regel.recept)}">${naam}</a>`;
  } else if (ing) {
    const rek = rekenIng(data.ingredienten, regel.ingredient); // algemene soort: waarden van het standaardmerk
    const twijfel = rek.controleren || (rek.per_100g == null && !rek.verwaarloosbaar);
    naamHtml = `<a class="ing-link" href="#/ingredient/${esc(regel.ingredient)}">${naam}</a>`
      + (twijfel ? ` <span class="twijfel" title="Voedingswaarde ontbreekt of moet gecontroleerd worden">?</span>` : "");
  }
  return `<li${attrs}><span class="hv">${esc(hoeveelheid(regel, factor))}</span><span class="nm">${naamHtml}</span></li>`;
}

function cijfer(label, waarde) {
  return `<span class="cijfer"><small>${label}</small> <b>${waarde}</b></span>`;
}

export function recept(main, data, id) {
  const r = data.recepten[id];
  if (!r) {
    main.innerHTML = `<p class="leeg-tekst">Recept niet gevonden. <a href="#/">Terug naar recepten</a></p>`;
    return;
  }
  const opties = r.keuzes?.opties || [];
  const s = receptStaat(id, r);
  const recent = recentGewijzigd(r);
  const basis = r.porties || 1;
  const factor = s.porties / basis;
  const t = voeding(r, data, s.keuze);
  const tags = afgeleideTags(r, data);
  const basisId = r.variant_van || r.id;
  const varianten = [data.recepten[basisId], ...Object.values(data.recepten)
    .filter((x) => x.variant_van === basisId)].filter(Boolean);
  const optie = opties.find((o) => o.id === s.keuze);
  const cat = data.categorieen.find((c) => c.id === r.categorie);
  const opMenu = data.menu.gerechten.some((g) => g.recept === id && !g.gegeten);
  const kookbeurt = kookbeurtOpMenu(data, id); // die wordt bij "Gekookt…" op het menu afgevinkt
  const keerGegeten = data.logboek.maaltijden.filter((m) => m.recept === id && zelfGegeten(m));
  const laatst = keerGegeten.map((m) => m.datum).sort().at(-1);
  const bewaard = data.voorraad.porties.filter((p) => p.recept === id);
  const eenheid = (n) => (r.porties ? (n === 1 ? "portie" : "porties") : "×");

  main.innerHTML = `
    <div class="actiebalk">
      <a class="terug" href="#/">← Recepten</a>
      <span class="acties">
        <a class="knop klein primair" href="#/recept/${esc(id)}/koken">Koken</a>
        ${opMenu ? `<a class="knop klein" href="#/menu">✓ Op het menu</a>`
          : `<button class="knop klein" data-plan>+ Op het menu</button>`}
        <button class="knop klein" data-gekookt>Gekookt…</button>
        <a class="knop klein alleen-laptop" href="#/recept/${esc(id)}/bewerken">Bewerken</a>
      </span>
    </div>
    <article class="kaart">
      <header class="kaart-kop">
        ${recent ? `<span class="badge nieuw" title="${esc(r.wijzigingen.at(-1).wat)}">${recent}</span>` : ""}
        <h1 class="titel">${esc(r.titel)}</h1>
        ${r.ondertitel ? `<p class="ondertitel">${esc(r.ondertitel)}</p>` : ""}
      </header>
      ${varianten.length > 1 ? `<nav class="tabs">${varianten.map((v) =>
        `<a class="tab${v.id === r.id ? " aan" : ""}" href="#/recept/${esc(v.id)}">${esc(v.id === basisId ? "Origineel" : v.ondertitel || v.titel)}</a>`).join("")}</nav>` : ""}
      <section class="cijfers">
        <div class="blok"><span class="label">Totaal gerecht</span>
          ${cijfer("KCAL", nl(t.kcal * factor))}${cijfer("EIWIT", `${nl(t.eiwit * factor)}g`)}</div>
        ${r.porties || r.opbrengst_g ? (() => {
          const d = r.porties ? basis : r.opbrengst_g / 100;
          const dec = r.porties ? 0 : 1;
          return `<div class="blok"><span class="label">${r.porties ? "Per portie" : `Per 100 g · opbrengst ±${nl(r.opbrengst_g * factor)} g`}</span>
          ${cijfer("KCAL", nl(t.kcal / d))}${cijfer("EIWIT", `${nl(t.eiwit / d, dec)}g`)}
          ${cijfer("VET", `${nl(t.vet / d, dec)}g`)}${cijfer("KH", `${nl(t.koolhydraten / d, dec)}g`)}</div>`;
        })() : ""}
        <div class="blok porties">
          <button class="stapper" data-d="-1" aria-label="Minder">−</button>
          <span class="aantal">${r.porties ? s.porties : `×${s.porties}`}</span>
          <button class="stapper" data-d="1" aria-label="Meer">+</button>
          <span class="label">${r.porties ? (s.porties === 1 ? "portie" : "porties") : "keer"}</span>
        </div>
      </section>
      ${t.onvolledig.size ? `<p class="waarschuwing">Voedingswaarde onvolledig: geen gegevens voor ${esc([...t.onvolledig].join(", "))}.</p>` : ""}
      ${opties.length ? `<div class="keuze"><span class="label">${esc(r.keuzes.titel || "Keuze")}</span>
        <nav class="tabs">${opties.map((o) => `<button class="tab${o.id === s.keuze ? " aan" : ""}" data-keuze="${esc(o.id)}">${esc(o.naam)}</button>`).join("")}</nav>
        ${optie ? `<div class="keuze-inhoud">${optie.keuken ? `<p class="keuken">${esc(optie.keuken)}</p>` : ""}
          <ul class="ingr">${optie.ingredienten.map((x) => regelHtml(x, data, factor)).join("")}</ul></div>` : ""}
      </div>` : ""}
      <section class="bereiding">
        <div class="kol-ingr">
          <h2 class="label">Ingrediënten</h2>
          <ul class="ingr">${r.stappen.map((st, i) => (st.ingredienten || [])
            .map((x, j) => regelHtml(x, data, factor,
              ` data-stap="${i}"${j === 0 && i > 0 ? ` class="groepstart"` : ""}`)).join("")).join("")}</ul>
        </div>
        <div class="kol-stappen">
          <h2 class="label">Bereiding</h2>
          <ol class="stappenlijst">${r.stappen.map((st, i) =>
            `<li data-stap="${i}" tabindex="0">${esc(st.instructie)}</li>`).join("")}</ol>
        </div>
      </section>
    </article>
    <section class="meta">
      <div class="meta-rij"><span class="label">Categorie</span> ${esc(cat?.naam || r.categorie)}</div>
      <div class="meta-rij"><span class="label">Gegeten</span> ${laatst
        ? `${esc(geleden(laatst))} <small>(${esc(datumNl(laatst))}${keerGegeten.length > 1 ? `, ${keerGegeten.length}× in het logboek` : ""})</small>`
        : `<small>nog niet in het logboek</small>`}</div>
      ${bewaard.length ? `<div class="meta-rij"><span class="label">Bewaard</span> ${bewaard.map((p) =>
        `${p.aantal}${r.porties ? " " : ""}${eenheid(p.aantal)} in de ${p.plek} <small>(gekookt ${esc(datumNl(p.gekookt))})</small>`).join(", ")}
        · <a href="#/voorraad">voorraad</a></div>` : ""}
      ${tags.eiwit.length ? `<div class="meta-rij"><span class="label">Eiwit</span> ${tags.eiwit.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}
      ${tags.groente.length ? `<div class="meta-rij"><span class="label">Groente</span> ${tags.groente.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}
      ${[...(r.tags?.keuken || []), ...(r.tags?.vibe || []), ...(tags.vegetarisch ? ["vegetarisch"] : [])].length
        ? `<div class="meta-rij"><span class="label">Tags</span> ${[...(r.tags?.keuken || []), ...(r.tags?.vibe || []), ...(tags.vegetarisch ? ["vegetarisch"] : [])].map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}
      <div class="meta-rij"><span class="label">Kosten</span> ${r.porties ? `${euro(t.kosten / basis)} per portie` : euro(t.kosten)}
        ${t.zonder_prijs.size ? `<small title="${esc([...t.zonder_prijs].join(", "))}">(excl. ${t.zonder_prijs.size} ingrediënt${t.zonder_prijs.size === 1 ? "" : "en"} zonder prijs)</small>` : ""}</div>
      ${r.notities?.length ? `<div class="meta-blok"><span class="label">Notities</span><ul>${r.notities.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
      ${r.wijzigingen?.length ? `<div class="meta-blok"><span class="label">Wijzigingen</span><ul class="wijz">${[...r.wijzigingen].reverse().map((w) => `<li><time>${esc(w.datum)}</time> ${esc(w.wat)}</li>`).join("")}</ul></div>` : ""}
      ${r.bron?.canva ? `<div class="meta-rij"><a href="https://www.canva.com/design/${esc(r.bron.canva)}/view" target="_blank" rel="noopener">Origineel in Canva ↗</a></div>` : ""}
    </section>`;

  main.querySelector("[data-plan]")?.addEventListener("click", (e) => {
    e.target.disabled = true;
    wijzig("menu", (doc) => {
      doc.gerechten.push({ id: nieuwId(), recept: id, porties: s.porties, ...(s.keuze ? { keuze: s.keuze } : {}) });
    }).then((d) => { melding("Op het menu gezet"); recept(main, d, id); }, (err) => {
      melding(err.message);
      e.target.disabled = false;
    });
  });
  main.querySelector("[data-gekookt]").addEventListener("click", () => gekookt({
    data, recept: r, porties: s.porties, keuze: s.keuze, menuId: kookbeurt?.id,
    klaar: (d) => recept(main, d, id),
  }));

  main.querySelectorAll(".stapper").forEach((b) => b.addEventListener("click", () => {
    s.porties = Math.max(1, s.porties + Number(b.dataset.d));
    recept(main, data, id);
  }));
  main.querySelectorAll("[data-keuze]").forEach((b) => b.addEventListener("click", () => {
    s.keuze = b.dataset.keuze;
    recept(main, data, id);
  }));

  // Stap aanwijzen licht de bijbehorende ingrediënten op; aanklikken zet hem vast
  // als "huidige stap" (handig tijdens het koken).
  const licht = (stap, klasse, aan) => main
    .querySelectorAll(`.bereiding [data-stap="${stap}"]`)
    .forEach((el) => el.classList.toggle(klasse, aan));
  main.querySelectorAll(".stappenlijst li").forEach((li) => {
    const n = li.dataset.stap;
    li.addEventListener("mouseenter", () => licht(n, "licht", true));
    li.addEventListener("mouseleave", () => licht(n, "licht", false));
    const kies = () => {
      const was = li.classList.contains("huidig");
      main.querySelectorAll(".bereiding .huidig").forEach((el) => el.classList.remove("huidig"));
      if (!was) licht(n, "huidig", true);
    };
    li.addEventListener("click", kies);
    li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kies(); } });
  });
}
