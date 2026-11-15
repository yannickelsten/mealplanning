import { wijzig } from "../store.js";
import { afgeleideTags } from "../voeding.js";
import { MOMENTEN, MOMENT_NAAM, bewaardPerGerecht, bewaardePorties, boodschappenlijst, dagwaarde, dekking, dezeWeek,
  gauwOp, kookVerdeling, laatstGegeten, momentVan, momentenVan, overlap, restenVan } from "../planning.js";
import { dagenTot, datumNl, esc, geleden, houdbaar, melding, nieuwId, plusDagen, vandaag, weekdag } from "../util.js";
import { gekookt } from "./gekookt.js";
import { aantalPorties, koppelPorties, portieActie, portiesHtml } from "./porties.js";
import { huidigVoorstel, koppelVoorstel, planDialoog, voorstelBalk, voorstelTegel } from "./weekplan.js";

// Keuzes blijven bewaard zolang de pagina open is.
const f = { sortering: "lang", categorie: "alle", vegetarisch: false, aantal: 9, week: null };
const STAP = 9;

const fout = (err) => melding(err.message);
const portieWoord = (r, n) => (r.porties ? (n === 1 ? "portie" : "porties") : "keer");

function receptOpties(data, met = () => true) {
  return data.categorieen.map((c) => {
    const rs = Object.values(data.recepten).filter((r) => r.categorie === c.id && met(r))
      .sort((a, b) => a.titel.localeCompare(b.titel, "nl") || (a.variant_van ? 1 : -1));
    if (!rs.length) return "";
    return `<optgroup label="${esc(c.naam)}">${rs.map((r) =>
      `<option value="r:${esc(r.id)}">${esc(r.titel)}${r.variant_van && r.ondertitel ? ` (${esc(r.ondertitel)})` : ""}</option>`).join("")}</optgroup>`;
  }).join("");
}

// Korte uitleg onder een gerecht in het rooster: hoeveel, en wat er met de rest gebeurt.
function tegelMeta(g, data, gerechten) {
  const r = data.recepten[g.recept];
  const keuze = !g.uit && r.keuzes?.opties?.find((o) => o.id === (g.keuze || r.keuzes.opties[0]?.id))?.naam;
  const delen = [];
  let let_op = "";
  if (g.uit === "voorraad") {
    const nogBewaard = data.voorraad.porties.some((p) => p.recept === g.recept);
    delen.push(nogBewaard ? "uit de koelkast/vriezer" : "uit de voorraad, maar er ligt niets meer");
    if (g.porties !== 1) delen.push(`${g.porties} porties`);
  } else if (g.van) {
    const kook = gerechten.find((x) => x.id === g.van);
    delen.push(kook?.dag ? `rest van ${weekdag(kook.dag)}` : "rest");
    if (g.porties !== 1) delen.push(`${g.porties} porties`);
    if (!kook) let_op = "de kookbeurt staat niet meer op het menu";
    else if (!kook.dag || (g.dag && g.dag <= kook.dag)) let_op = "staat niet ná het koken";
  } else {
    const v = kookVerdeling(g, gerechten);
    delen.push(`${g.porties} ${portieWoord(r, g.porties)} koken`);
    if (v.resten || v.vriezer) {
      delen.push(`${v.nu} nu`);
      if (v.resten) delen.push(`${v.resten} later`);
      if (v.vriezer) delen.push(`${v.vriezer} naar de vriezer`);
    }
  }
  if (keuze) delen.unshift(keuze);
  if (g.dag && g.dag < vandaag()) delen.push(`gepland voor ${datumNl(g.dag)}`);
  return { tekst: delen.join(" · "), let_op };
}

// Eén gerecht in het weekrooster. Tikken op de naam opent het venster met alle keuzes.
function tegel(g, data, gerechten) {
  const r = data.recepten[g.recept];
  const soort = g.uit === "voorraad" ? "voorraad" : g.van ? "rest" : "kook";
  const { tekst, let_op } = tegelMeta(g, data, gerechten);
  const knop = soort === "voorraad" ? "Gegeten" : soort === "kook" ? "Gekookt" : "";
  return `<div class="wr-gerecht ${soort}" data-id="${esc(g.id)}">
    <button type="button" class="wr-titel" data-open title="Aanpassen">${esc(r.titel)}</button>
    <small class="wr-meta">${esc(tekst)}</small>
    ${let_op ? `<small class="wr-letop">${esc(let_op)}</small>` : ""}
    ${knop ? `<button type="button" class="knop klein" data-klaar>${knop}</button>` : ""}
  </div>`;
}

// Venster bij een gerecht op het menu: dag, moment, keuze, porties, en weghalen.
function gerechtDialoog(g, data, kiesDagen, herteken) {
  const r = data.recepten[g.recept];
  const gerechten = data.menu.gerechten;
  const opties = r.keuzes?.opties || [];
  const uitVoorraad = g.uit === "voorraad";
  const kook = !uitVoorraad && !g.van;
  const resten = kook ? restenVan(gerechten, g.id) : [];
  const v = kook ? kookVerdeling(g, gerechten) : null;
  const dagen = g.dag && !kiesDagen.includes(g.dag) ? [g.dag, ...kiesDagen] : kiesDagen;
  const moment = momentVan(g, data);
  const restTekst = resten.length ? `Rest: ${resten.map((x) => `${x.dag ? weekdag(x.dag) : "nog niet ingepland"} ${MOMENT_NAAM[momentVan(x, data)].toLowerCase()} (${x.porties})`).join(", ")}.` : "";

  const dlg = document.createElement("dialog");
  dlg.className = "dialoog";
  dlg.innerHTML = `<form novalidate>
    <h2 class="dl-kop">${esc(r.titel)}</h2>
    <p class="dl-titel"><small>${esc(tegelMeta(g, data, gerechten).tekst)}</small> · <a href="#/recept/${esc(r.id)}">naar het recept</a></p>
    <div class="twee">
      <label class="veld"><span>Dag</span><select name="dag"><option value="">nog niet ingepland</option>${dagen.map((d) =>
        `<option value="${d}" ${d === g.dag ? "selected" : ""}>${esc(datumNl(d))}</option>`).join("")}</select></label>
      <label class="veld"><span>Moment</span><select name="moment">${MOMENTEN.map(([m, naam]) =>
        `<option value="${m}" ${m === moment ? "selected" : ""}>${naam}</option>`).join("")}</select></label>
    </div>
    ${opties.length && !uitVoorraad ? `<label class="veld"><span>${esc(r.keuzes.titel || "Keuze")}</span><select name="keuze">${opties.map((o) =>
      `<option value="${esc(o.id)}" ${o.id === (g.keuze || opties[0].id) ? "selected" : ""}>${esc(o.naam)}</option>`).join("")}</select></label>` : ""}
    ${kook ? `<div class="twee">
        <label class="veld"><span>${r.porties ? "Porties koken" : "Keer maken"}</span><input type="number" name="porties" min="1" step="1" value="${g.porties}"></label>
        ${r.porties ? `<label class="veld"><span>Daarvan nu eten</span><input type="number" name="eten" min="0" step="1" value="${v.nu}"></label>` : ""}
      </div>
      <p class="hint dl-plan"></p>`
      : `<label class="veld"><span>Porties</span><input type="number" name="porties" min="1" step="1" value="${g.porties}"></label>`}
    ${g.van ? `<p class="hint">Dit is de rest van een kookbeurt; je kookt het dus niet opnieuw.</p>` : ""}
    <div class="knoppen">
      <button class="knop primair" type="submit">Opslaan</button>
      ${kook || uitVoorraad ? `<button class="knop" type="button" data-klaar>${uitVoorraad ? "Gegeten" : "Gekookt…"}</button>` : ""}
      <button class="knop" type="button" data-annuleer>Annuleren</button>
      <button class="knop gevaar" type="button" data-weg>Van het menu halen</button>
    </div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form");
  const getal = (naam, min) => Math.max(min, Math.round(Number(form[naam]?.value) || 0));
  const planEl = dlg.querySelector(".dl-plan");
  const toonPlan = () => {
    if (!planEl) return;
    const n = getal("porties", 1);
    const nu = Math.min(form.eten ? getal("eten", 0) : n, n);
    const later = Math.min(v.resten, n - nu);
    const vriezer = n - nu - later;
    planEl.textContent = [restTekst, vriezer ? `${vriezer} ${vriezer === 1 ? "portie" : "porties"} naar de vriezer.` : "",
      later < v.resten ? "Te weinig porties voor alle resten die gepland staan." : ""].filter(Boolean).join(" ");
  };
  toonPlan();
  form.addEventListener("input", toonPlan);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelector("[data-annuleer]").addEventListener("click", () => dlg.close());
  const pas = (fn) => wijzig("menu", (doc) => {
    const x = doc.gerechten.find((y) => y.id === g.id);
    if (x) fn(x, doc);
  }).then((d) => { dlg.close(); herteken(d); }, fout);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const dag = form.dag.value || null;
    const porties = getal("porties", 1);
    const eten = form.eten ? Math.min(getal("eten", 0), porties) : null;
    pas((x, doc) => {
      const eigenResten = kook ? restenVan(doc.gerechten, x.id) : [];
      // Schuift de kookbeurt een paar dagen op, dan schuiven de resten mee.
      if (x.dag && dag && dag !== x.dag) {
        const verschil = dagenTot(dag) - dagenTot(x.dag);
        for (const y of eigenResten) if (y.dag) y.dag = plusDagen(y.dag, verschil);
      }
      if (dag) x.dag = dag; else delete x.dag;
      x.moment = form.moment.value;
      if (form.keuze) {
        x.keuze = form.keuze.value;
        for (const y of eigenResten) y.keuze = x.keuze;
      }
      x.porties = porties;
      // 'eten' alleen bewaren als er iets naar de vriezer gaat; anders volgt het uit de resten.
      const restSom = eigenResten.reduce((s, y) => s + y.porties, 0);
      if (eten != null && eten + restSom < porties) x.eten = eten; else delete x.eten;
    });
  });
  dlg.querySelector("[data-weg]").addEventListener("click", () => pas((x, doc) => {
    // Een kookbeurt weghalen haalt ook de resten ervan weg.
    doc.gerechten = doc.gerechten.filter((y) => y.id !== g.id && !(kook && y.van === g.id));
  }));
  dlg.querySelector("[data-klaar]")?.addEventListener("click", () => { dlg.close(); klaarMet(g, data, herteken); });
  dlg.showModal();
}

// "Gekookt" (een kookbeurt) of "Gegeten" (een portie uit de koelkast/vriezer).
function klaarMet(g, data, herteken) {
  const r = data.recepten[g.recept];
  if (g.uit !== "voorraad") {
    return gekookt({ data, recept: r, porties: g.porties, keuze: g.keuze || r.keuzes?.opties?.[0]?.id, menuId: g.id, klaar: herteken });
  }
  // Uit de voorraad: de portie die het eerst op moet.
  const p = bewaardePorties(data).find((x) => x.recept === g.recept);
  const vanMenu = () => wijzig("menu", (doc) => { doc.gerechten = doc.gerechten.filter((y) => y.id !== g.id); }).then(herteken, fout);
  if (!p) {
    if (confirm(`Er ligt geen ${r.titel} meer in de koelkast of vriezer. Van het menu halen?`)) vanMenu();
    return;
  }
  portieActie(data, p, "eten", vanMenu);
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

  // Weekrooster
  const gerechten = data.menu.gerechten.filter((g) => data.recepten[g.recept]);
  const opMenu = new Set(gerechten.map((g) => g.recept));
  const inTePlannen = gerechten.filter((g) => !g.dag || g.dag < nu);
  const lijst = boodschappenlijst(data);
  const teKopen = lijst.filter((x) => x.status === "kopen" && !x.later).length + data.boodschappen.extra.length;
  const bewaardeRecepten = [...new Set(data.voorraad.porties.map((p) => p.recept))].filter((id) => data.recepten[id]);
  const voorstel = huidigVoorstel();
  // Keuzelijst per vak: eerst wat bewaard is, dan wat bij dit moment past, dan de rest.
  const optie = (r) => `<option value="r:${esc(r.id)}">${esc(r.titel)}${r.variant_van && r.ondertitel ? ` (${esc(r.ondertitel)})` : ""}</option>`;
  const optiesPerMoment = Object.fromEntries(MOMENTEN.map(([m, naam]) => {
    const past = Object.values(data.recepten).filter((r) => momentenVan(r, data).includes(m))
      .sort((a, b) => a.titel.localeCompare(b.titel, "nl") || (a.variant_van ? 1 : -1));
    return [m, `${bewaardeRecepten.length ? `<optgroup label="Uit de koelkast/vriezer">${bewaardeRecepten
      .map((id) => `<option value="v:${esc(id)}">${esc(data.recepten[id].titel)}</option>`).join("")}</optgroup>` : ""}
      ${past.length ? `<optgroup label="Past bij ${esc(naam.toLowerCase())}">${past.map(optie).join("")}</optgroup>` : ""}
      ${receptOpties(data, (r) => !momentenVan(r, data).includes(m))}`];
  }));
  const toevoegKeuze = (dag, m) => `<select class="dag-toevoegen" data-dag="${dag}" data-moment="${m}" aria-label="${esc(MOMENT_NAAM[m])} toevoegen op ${esc(datumNl(dag))}">
    <option value="">+ toevoegen…</option>${optiesPerMoment[m]}</select>`;
  const rooster = `<div class="weekrooster">
    <div class="wr-labels" aria-hidden="true"><div></div>${MOMENTEN.map(([, naam]) => `<div class="wr-label">${naam}</div>`).join("")}</div>
    ${weekDagen.map((d) => `<section class="wr-dag${d === nu ? " vandaag" : ""}">
      <h3 class="wr-dagkop">${esc(weekdag(d))} <small>${esc(datumNl(d).replace(/^\S+ /, ""))}${d === nu ? " · vandaag" : ""}</small></h3>
      ${MOMENTEN.map(([m, naam]) => {
        const hier = gerechten.filter((g) => g.dag === d && momentVan(g, data) === m);
        const vs = voorstel ? voorstel.items.filter((i) => i.dag === d && i.moment === m) : [];
        return `<div class="wr-cel${hier.length || vs.length ? "" : " leeg"}">
          <span class="wr-celkop">${naam}</span>
          ${hier.map((g) => tegel(g, data, gerechten)).join("")}
          ${vs.map((i) => voorstelTegel(i, data)).join("")}
          ${toevoegKeuze(d, m)}
        </div>`;
      }).join("")}
    </section>`).join("")}
  </div>`;

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
      ${voorstel ? voorstelBalk(data, weekDagen[6])
        : `<p class="planknop"><button class="knop primair" data-voorstel>Stel een weekplan voor…</button>
          <small class="hint">Vult de lege vakken op basis van wat je in huis hebt, afwisseling en wat je lang niet hebt gegeten.</small></p>`}
      ${inTePlannen.length ? `<div class="wr-los"><h3 class="wr-loskop">Nog in te plannen</h3>
        <div class="wr-lostegels">${inTePlannen.map((g) => tegel(g, data, gerechten)).join("")}</div></div>` : ""}
      ${rooster}
      <p class="na-rooster"><a class="knop" href="#/boodschappen">Boodschappenlijst${teKopen ? ` (${teKopen})` : ""} →</a>
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

  // Weekrooster
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
      doc.gerechten.push({ id: nieuwId(), recept: id, porties: soort === "v" ? 1 : r.porties || 1,
        dag: sel.dataset.dag, moment: sel.dataset.moment, ...(soort === "v" ? { uit: "voorraad" } : {}) });
    }).then(herteken, fout);
  }));
  main.querySelectorAll(".wr-gerecht[data-id]").forEach((el) => {
    const g = gerechten.find((x) => x.id === el.dataset.id);
    if (!g) return;
    el.querySelector("[data-open]").addEventListener("click", () => gerechtDialoog(g, data, kiesDagen, herteken));
    el.querySelector("[data-klaar]")?.addEventListener("click", () => klaarMet(g, data, herteken));
  });
  main.querySelector("[data-voorstel]")?.addEventListener("click", () => planDialoog(data, (opties) => {
    f.week = opties.begin > nu ? opties.begin : null;
    herteken(data);
  }));
  koppelVoorstel(main, data, herteken);

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
