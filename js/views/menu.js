import { wijzig } from "../store.js";
import { afgeleideTags } from "../voeding.js";
import { bewaardPerGerecht, bewaardePorties, boodschappenlijst, dagwaarde, dekking, dezeWeek, gauwOp,
  laatstGegeten, overlap } from "../planning.js";
import { dagenTot, datumNl, esc, geleden, houdbaar, melding, nieuwId, plusDagen, vandaag } from "../util.js";
import { gekookt } from "./gekookt.js";
import { aantalPorties, koppelPorties, portieActie, portiesHtml } from "./porties.js";

// Keuzes blijven bewaard zolang de pagina open is.
const f = { sortering: "lang", categorie: "alle", vegetarisch: false, aantal: 9, week: null };
const STAP = 9;

const fout = (err) => melding(err.message);
const weekdag = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long" });

function receptOpties(data, met = () => true) {
  return data.categorieen.map((c) => {
    const rs = Object.values(data.recepten).filter((r) => r.categorie === c.id && met(r))
      .sort((a, b) => a.titel.localeCompare(b.titel, "nl") || (a.variant_van ? 1 : -1));
    if (!rs.length) return "";
    return `<optgroup label="${esc(c.naam)}">${rs.map((r) =>
      `<option value="r:${esc(r.id)}">${esc(r.titel)}${r.variant_van && r.ondertitel ? ` (${esc(r.ondertitel)})` : ""}</option>`).join("")}</optgroup>`;
  }).join("");
}

// Eén gerecht in de weekplanning.
function planRij(g, data, dagen) {
  const r = data.recepten[g.recept];
  const opties = r.keuzes?.opties || [];
  const keuze = g.keuze || opties[0]?.id;
  const uitVoorraad = g.uit === "voorraad";
  const nogBewaard = data.voorraad.porties.some((p) => p.recept === g.recept);
  const eerder = g.dag && g.dag < vandaag();
  return `<li data-id="${esc(g.id)}" class="${uitVoorraad ? "uit-voorraad" : ""}">
    <div class="ml-naam"><a href="#/recept/${esc(r.id)}">${esc(r.titel)}</a>
      <small>${[uitVoorraad ? (nogBewaard ? "uit de koelkast/vriezer" : "uit de voorraad, maar er ligt niets meer") : r.ondertitel,
        eerder ? `gepland voor ${datumNl(g.dag)}` : ""].filter(Boolean).map(esc).join(" · ")}</small></div>
    ${opties.length && !uitVoorraad ? `<select data-keuze aria-label="${esc(r.keuzes.titel || "Keuze")}">${opties.map((o) =>
      `<option value="${esc(o.id)}" ${o.id === keuze ? "selected" : ""}>${esc(o.naam)}</option>`).join("")}</select>` : ""}
    <select data-dag aria-label="Dag"><option value="">nog niet ingepland</option>${
      (g.dag && !dagen.includes(g.dag) ? [g.dag, ...dagen] : dagen).map((d) =>
      `<option value="${d}" ${d === g.dag ? "selected" : ""}>${esc(datumNl(d))}</option>`).join("")}</select>
    ${uitVoorraad ? "" : `<div class="ml-porties">
      <button class="stapper" data-d="-1" aria-label="Minder">−</button>
      <span class="aantal">${g.porties}</span>
      <button class="stapper" data-d="1" aria-label="Meer">+</button>
      <small>${r.porties ? (g.porties === 1 ? "portie" : "porties") : "keer"}</small>
    </div>`}
    <button class="knop klein" data-klaar>${uitVoorraad ? "Gegeten" : "Gekookt"}</button>
    <button class="kruisje" data-weg aria-label="Van het menu halen" title="Van het menu halen">×</button>
  </li>`;
}

function suggestieKaart(i, opMenu, metVoorraad) {
  const { r, dek } = i;
  const redenen = [];
  if (f.sortering === "favorieten") redenen.push(`${i.laatst.aantal}× gegeten, laatst ${geleden(i.laatst.datum)}`);
  else redenen.push(i.laatst ? `Laatst gegeten ${geleden(i.laatst.datum)}` : "Nog niet gegeten");
  if (i.bewaard) {
    const { koelkast, vriezer } = i.bewaard;
    redenen.push(`Al ${[koelkast && `${koelkast} in de koelkast`, vriezer && `${vriezer} in de vriezer`].filter(Boolean).join(" en ")}`);
  }
  if (metVoorraad && dek.totaal) {
    const n = dek.ontbreekt.length;
    redenen.push(!n ? "Alles in huis"
      : n <= 3 ? `Nog kopen: ${dek.ontbreekt.join(", ").toLowerCase()}`
      : `Nog ${n} van ${dek.totaal} ingrediënten kopen`);
  }
  const gauw = dek.gauw.length
    ? `<span class="rk-gauw">Gebruikt ${esc(dek.gauw.map((g) => `${g.naam.toLowerCase()} (${g.open ? "open, " : ""}${houdbaar(g.datum)})`).join(", "))}</span>` : "";
  const veel = i.ov.meest && i.ov.meest[1] >= 2
    ? `<span class="rk-afwisseling">Deze week al ${i.ov.meest[1]}× ${esc(i.ov.meest[0])}</span>` : "";
  const al = opMenu.has(r.id);
  return `<div class="receptkaart suggestie">
    <a class="rk-titel" href="#/recept/${esc(r.id)}">${esc(r.titel)}</a>
    ${r.ondertitel ? `<span class="rk-onder">${esc(r.ondertitel)}</span>` : ""}
    <span class="rk-reden">${redenen.map(esc).join(" · ")}</span>${gauw}${veel}
    <button class="knop klein" data-plan="${esc(r.id)}" ${al ? "disabled" : ""}>${al ? "✓ Op het menu" : "+ Op het menu"}</button>
  </div>`;
}

export function menu(main, data, sortering) {
  if (sortering) f.sortering = sortering;
  const herteken = (d) => menu(main, d);
  const nu = vandaag();
  // De komende 7 dagen vanaf vandaag (met ‹ › een week verder kijken). Wat op een dag gepland
  // stond die al voorbij is, staat bij "Nog in te plannen".
  if (f.week && f.week <= nu) f.week = null;
  const begin = f.week || nu;
  const weekDagen = Array.from({ length: 7 }, (_, n) => plusDagen(begin, n));
  // Kiesbare dagen: twee weken vanaf het begin van wat je ziet.
  const kiesDagen = Array.from({ length: 14 }, (_, n) => plusDagen(begin, n));

  // Weekplanning
  const gerechten = data.menu.gerechten.filter((g) => data.recepten[g.recept]);
  const opMenu = new Set(gerechten.map((g) => g.recept));
  const inTePlannen = gerechten.filter((g) => !g.dag || g.dag < nu);
  const lijst = boodschappenlijst(data);
  const teKopen = lijst.filter((x) => x.status === "kopen" && !x.later).length + data.boodschappen.extra.length;
  const bewaardeRecepten = new Set(data.voorraad.porties.map((p) => p.recept));
  const toevoegKeuze = (dag) => `<select class="dag-toevoegen" data-dag="${dag}" aria-label="Gerecht toevoegen">
    <option value="">+ toevoegen…</option>
    ${bewaardeRecepten.size ? `<optgroup label="Uit de koelkast/vriezer">${[...bewaardeRecepten].filter((id) => data.recepten[id])
      .map((id) => `<option value="v:${esc(id)}">${esc(data.recepten[id].titel)}</option>`).join("")}</optgroup>` : ""}
    ${receptOpties(data)}</select>`;

  // Suggesties
  const onderdeel = new Set(data.categorieen.filter((c) => c.onderdeel).map((c) => c.id));
  const kandidaten = Object.values(data.recepten).filter((r) => !r.variant_van && !onderdeel.has(r.categorie));
  const cats = data.categorieen.filter((c) => kandidaten.some((r) => r.categorie === c.id));
  const laatst = laatstGegeten(data);
  const bewaard = bewaardPerGerecht(data);
  const week = dezeWeek(data);
  const metVoorraad = data.voorraad.ingredienten.length > 0;
  const gauw = gauwOp(data);
  let items = kandidaten
    .filter((r) => f.categorie === "alle" || r.categorie === f.categorie)
    .map((r) => ({ r, laatst: laatst[r.id], bewaard: bewaard[r.id], dek: dekking(r, data),
      veg: afgeleideTags(r, data).vegetarisch, ov: overlap(r, data, week) }))
    .filter((i) => !f.vegetarisch || i.veg);
  const dagen = (i) => (i.laatst ? -dagenTot(i.laatst.datum) : 60);
  // Afwisseling: wat qua soort gerecht, keuken of eiwit al vaak voorkomt deze week, zakt.
  const score = (i) => Math.min(dagen(i), 60) - 8 * i.ov.score;
  const schud = (a, b) => dagwaarde(a.r.id) - dagwaarde(b.r.id);
  // Wat al klaar in de koelkast/vriezer ligt hoef je niet te koken: achteraan.
  const alKlaar = (a, b) => !!a.bewaard - !!b.bewaard;
  if (f.sortering === "voorraad") {
    items.sort((a, b) => alKlaar(a, b) || b.dek.gauw.length - a.dek.gauw.length
      || a.dek.ontbreekt.length - b.dek.ontbreekt.length || score(b) - score(a) || schud(a, b));
  } else if (f.sortering === "favorieten") {
    // Wat je vaker hebt gegeten, en al even niet: "kook nog eens".
    items = items.filter((i) => i.laatst?.aantal >= 2 && dagen(i) >= 7);
    items.sort((a, b) => b.laatst.aantal - a.laatst.aantal || dagen(b) - dagen(a) || schud(a, b));
  } else {
    items.sort((a, b) => alKlaar(a, b) || score(b) - score(a) || schud(a, b));
  }

  // Klaar om te eten: koelkast en vriezer elk in een eigen vak.
  const klaar = ["koelkast", "vriezer"].map((plek) => {
    const html = portiesHtml(data, { plek });
    return html && `<div class="plekvak ${plek}">
      <h3 class="plekkop">${plek === "koelkast" ? "Koelkast" : "Vriezer"} <small>${aantalPorties(data, plek)}</small></h3>
      ${html}</div>`;
  }).filter(Boolean).join("");

  main.innerHTML = `
    <h1 class="paginatitel">Wat eten we?</h1>
    ${klaar ? `<section class="blokje">
      <h2 class="kop2">Klaar om te eten</h2>
      ${klaar}
    </section>` : ""}

    <section class="blokje">
      <div class="kopregel"><h2 class="kop2">${begin === nu ? "De komende 7 dagen" : `${esc(datumNl(begin))} – ${esc(datumNl(weekDagen[6]))}`}</h2>
        <span class="weeknav">
          ${begin > nu ? `<button class="knop klein" data-week="-7" aria-label="Week terug">‹</button>
            <button class="knop klein" data-week="0">Vanaf vandaag</button>` : ""}
          <button class="knop klein" data-week="7" aria-label="Week verder">›</button></span></div>
      ${inTePlannen.length ? `<div class="dagvak ongepland"><h3 class="dagkop">Nog in te plannen</h3>
        <ul class="menulijst">${inTePlannen.map((g) => planRij(g, data, kiesDagen)).join("")}</ul></div>` : ""}
      ${weekDagen.map((d) => {
        const hier = gerechten.filter((g) => g.dag === d);
        return `<div class="dagvak${d === nu ? " vandaag" : ""}">
          <h3 class="dagkop">${esc(weekdag(d))} <small>${esc(datumNl(d).replace(/^\S+ /, ""))}${d === nu ? " · vandaag" : ""}</small></h3>
          ${hier.length ? `<ul class="menulijst">${hier.map((g) => planRij(g, data, kiesDagen)).join("")}</ul>` : ""}
          ${toevoegKeuze(d)}
        </div>`;
      }).join("")}
      <p><a class="knop" href="#/boodschappen">Boodschappenlijst${teKopen ? ` (${teKopen})` : ""} →</a>
        <a class="knop" href="#/logboek">Logboek →</a></p>
    </section>

    <section class="blokje">
      <h2 class="kop2">Suggesties</h2>
      <div class="filters">
        <div class="chipgroep">
          <button class="chip${f.sortering === "lang" ? " aan" : ""}" data-sort="lang">Lang niet gegeten</button>
          <button class="chip${f.sortering === "voorraad" ? " aan" : ""}" data-sort="voorraad">Met wat ik in huis heb</button>
          <button class="chip${f.sortering === "favorieten" ? " aan" : ""}" data-sort="favorieten">Favorieten</button>
        </div>
        <div class="chipgroep">
          <button class="chip${f.categorie === "alle" ? " aan" : ""}" data-cat="alle">Alle</button>
          ${cats.map((c) => `<button class="chip${f.categorie === c.id ? " aan" : ""}" data-cat="${esc(c.id)}">${esc(c.naam)}</button>`).join("")}
          <button class="chip${f.vegetarisch ? " aan" : ""}" data-veg>Vegetarisch</button>
        </div>
      </div>
      ${f.sortering === "voorraad" && !metVoorraad
        ? `<p class="waarschuwing los">Je voorraad is nog leeg. Zet bij <a href="#/voorraad">Voorraad</a> wat je in huis hebt, dan kijken de suggesties daarnaar.</p>` : ""}
      ${gauw.length ? `<p class="waarschuwing los"><b>Gauw opmaken:</b> ${gauw.slice(0, 6).map((x) =>
        `${esc(x.ing?.naam || x.p.ingredient)} (${x.p.geopend ? "open, " : ""}${esc(houdbaar(x.datum))})`).join(", ")}${gauw.length > 6 ? " …" : ""}.
        ${f.sortering !== "voorraad" ? `<button class="chip" data-gauw>Recepten die dit gebruiken</button>` : ""}</p>` : ""}
      ${items.length ? `<div class="raster">${items.slice(0, f.aantal).map((i) => suggestieKaart(i, opMenu, metVoorraad)).join("")}</div>
        ${items.length > f.aantal ? `<p><button class="chip leeg" data-meer>Meer suggesties</button></p>` : ""}`
        : `<p class="leeg-tekst">${f.sortering === "favorieten"
          ? "Nog geen favorieten: gerechten die je vaker eet (en al even niet hebt gehad) komen hier vanzelf."
          : "Geen recepten met deze keuzes."}</p>`}
    </section>`;

  koppelPorties(main, data, herteken);

  // Weekplanning
  main.querySelectorAll("[data-week]").forEach((b) => b.addEventListener("click", () => {
    const d = Number(b.dataset.week);
    f.week = d ? plusDagen(begin, d) : null;
    herteken(data);
  }));
  main.querySelectorAll(".dag-toevoegen").forEach((sel) => sel.addEventListener("change", () => {
    const [soort, id] = sel.value.split(":");
    if (!id) return;
    const r = data.recepten[id];
    wijzig("menu", (doc) => {
      doc.gerechten.push({ id: nieuwId(), recept: id, porties: soort === "v" ? 1 : r.porties || 1, dag: sel.dataset.dag,
        ...(soort === "v" ? { uit: "voorraad" } : {}) });
    }).then(herteken, fout);
  }));
  main.querySelectorAll(".menulijst li").forEach((li) => {
    const id = li.dataset.id;
    const g = gerechten.find((x) => x.id === id);
    const pas = (fn) => wijzig("menu", (doc) => {
      const x = doc.gerechten.find((y) => y.id === id);
      if (x) fn(x, doc);
    }).then(herteken, fout);
    li.querySelectorAll(".stapper").forEach((b) => b.addEventListener("click", () => {
      const nieuw = Math.max(1, g.porties + Number(b.dataset.d));
      pas((x) => { x.porties = nieuw; });
    }));
    li.querySelector("[data-keuze]")?.addEventListener("change", (e) => pas((x) => { x.keuze = e.target.value; }));
    li.querySelector("[data-dag]").addEventListener("change", (e) => pas((x) => {
      if (e.target.value) x.dag = e.target.value; else delete x.dag;
    }));
    li.querySelector("[data-weg]").addEventListener("click", () => pas((x, doc) => {
      doc.gerechten = doc.gerechten.filter((y) => y.id !== id);
    }));
    li.querySelector("[data-klaar]").addEventListener("click", () => {
      const r = data.recepten[g.recept];
      if (g.uit !== "voorraad") {
        return gekookt({ data, recept: r, porties: g.porties, keuze: g.keuze || r.keuzes?.opties?.[0]?.id, menuId: g.id, klaar: herteken });
      }
      // Uit de voorraad: de portie die het eerst op moet.
      const p = bewaardePorties(data).find((x) => x.recept === g.recept);
      const vanMenu = () => wijzig("menu", (doc) => { doc.gerechten = doc.gerechten.filter((y) => y.id !== id); }).then(herteken, fout);
      if (!p) {
        if (confirm(`Er ligt geen ${r.titel} meer in de koelkast of vriezer. Van het menu halen?`)) vanMenu();
        return;
      }
      portieActie(data, p, "eten", vanMenu);
    });
  });

  // Suggesties
  main.querySelector(".filters").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.sort) f.sortering = b.dataset.sort;
    else if (b.dataset.cat) f.categorie = b.dataset.cat;
    else if ("veg" in b.dataset) f.vegetarisch = !f.vegetarisch;
    f.aantal = STAP;
    // #/menu/voorraad zou de sortering bij opnieuw tekenen terugzetten
    if (location.hash !== "#/menu") history.replaceState(null, "", "#/menu");
    herteken(data);
  });
  main.querySelector("[data-meer]")?.addEventListener("click", () => { f.aantal += STAP; herteken(data); });
  main.querySelector("[data-gauw]")?.addEventListener("click", () => {
    f.sortering = "voorraad";
    f.aantal = STAP;
    herteken(data);
  });
  main.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", () => {
    const r = data.recepten[b.dataset.plan];
    b.disabled = true;
    wijzig("menu", (doc) => {
      doc.gerechten.push({ id: nieuwId(), recept: r.id, porties: r.porties || 1 });
    }).then((d) => { melding(`${r.titel} staat op het menu: kies hierboven een dag`); herteken(d); }, fout);
  }));
}
