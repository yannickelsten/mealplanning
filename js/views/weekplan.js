// "Stel een weekplan voor": vraagt voor hoeveel dagen, mensen en welke momenten, laat het
// voorstel in het weekrooster zien (gestippeld), en zet wat je aanvinkt op het menu.
// Het voorstel staat alleen in het geheugen tot je het accepteert; de pagina mag intussen
// gewoon opnieuw getekend worden.
import { wijzig } from "../store.js";
import { MOMENTEN, boodschappenlijst, stelPlanVoor } from "../planning.js";
import { datumNl, esc, melding, nieuwId, plusDagen, vandaag, weekdag } from "../util.js";

let voorstel = null; // {opties, ronde, items, uitgesloten}
let aanroepen = 0;
export const huidigVoorstel = () => voorstel;

const fout = (err) => melding(err.message);
const STANDAARD = { dagen: 7, eters: 1, momenten: ["lunch", "diner"] };

function maak(data, opties, { ronde = 0, vast = [], uitgesloten = new Set() } = {}) {
  const items = stelPlanVoor(data, { ...opties, ronde, vast, uitgesloten, sleutel: `v${++aanroepen}` })
    .map((i) => ({ aan: true, ...i }));
  voorstel = { opties, ronde, items, uitgesloten };
}

// Een rest telt alleen als de kookbeurt ook aangevinkt is.
const kookVan = (i) => (i.van ? voorstel.items.find((x) => x.tid === i.van) : null);
const actief = (i) => i.aan && (!i.van || kookVan(i)?.aan !== false);

// Het venster met de keuzes. `klaar(opties)` tekent daarna opnieuw.
export function planDialoog(data, klaar) {
  const p = { ...STANDAARD, ...(data.instellingen.planner || {}) };
  const dlg = document.createElement("dialog");
  dlg.className = "dialoog";
  dlg.innerHTML = `<form novalidate>
    <h2 class="dl-kop">Weekplan voorstellen</h2>
    <p class="hint">Wat al op het menu staat blijft staan; alleen de lege vakken worden ingevuld. Er komt
      pas iets op het menu als je het voorstel goedkeurt.</p>
    <div class="twee">
      <label class="veld"><span>Vanaf</span><input type="date" name="begin" value="${vandaag()}" min="${vandaag()}"></label>
      <label class="veld"><span>Aantal dagen</span><input type="number" name="dagen" min="1" max="14" step="1" value="${p.dagen}"></label>
    </div>
    <label class="veld"><span>Met hoeveel mensen eet je?</span><input type="number" name="eters" min="1" max="12" step="1" value="${p.eters}">
      <small>Zoveel porties per maaltijd. Wat er bij het koken overblijft, komt de dagen erna terug als lunch of avondeten.</small></label>
    <fieldset class="keuzerij"><legend>Welke maaltijden invullen?</legend>
      ${MOMENTEN.map(([m, naam]) => `<label class="vink"><input type="checkbox" name="moment" value="${m}" ${p.momenten.includes(m) ? "checked" : ""}> ${naam}</label>`).join("")}
    </fieldset>
    <p class="fout" hidden></p>
    <div class="knoppen"><button class="knop primair" type="submit">Maak voorstel</button>
      <button class="knop" type="button" data-annuleer>Annuleren</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form");
  dlg.querySelector("[data-annuleer]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => dlg.remove());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const foutEl = form.querySelector(".fout");
    const momenten = [...form.querySelectorAll("[name=moment]:checked")].map((i) => i.value);
    const begin = /^\d{4}-\d{2}-\d{2}$/.test(form.begin.value) && form.begin.value >= vandaag() ? form.begin.value : vandaag();
    const dagen = Math.min(14, Math.max(1, Math.round(Number(form.dagen.value) || 7)));
    const eters = Math.min(12, Math.max(1, Math.round(Number(form.eters.value) || 1)));
    if (!momenten.length) {
      foutEl.textContent = "Kies minstens één maaltijd.";
      foutEl.hidden = false;
      return;
    }
    const opties = { begin, dagen, eters, momenten };
    maak(data, opties);
    dlg.close();
    klaar(opties);
    if (!voorstel.items.length) melding("Geen lege vakken of geen passende recepten gevonden");
    // Keuzes onthouden voor de volgende keer (zonder te wachten).
    const nieuw = { dagen, eters, momenten };
    if (JSON.stringify(nieuw) !== JSON.stringify(data.instellingen.planner || null)) {
      wijzig("instellingen", (doc) => { doc.planner = nieuw; }).catch(fout);
    }
  });
  dlg.showModal();
}

// Een voorgesteld gerecht in het rooster.
export function voorstelTegel(i, data) {
  const r = data.recepten[i.recept];
  if (!r) return "";
  const n = (x) => `${x} ${x === 1 ? "portie" : "porties"}`;
  let meta;
  if (i.uit) meta = `uit de koelkast · ${n(i.porties)}`;
  else if (i.van) meta = `rest van ${weekdag(kookVan(i)?.dag || i.dag)}${i.porties !== 1 ? ` · ${n(i.porties)}` : ""}`;
  else {
    const later = voorstel.items.filter((x) => x.van === i.tid && actief(x)).reduce((s, x) => s + x.porties, 0);
    const vriezer = i.porties - i.eten - later;
    meta = [`${n(i.porties)} koken`, (later || vriezer) && `${i.eten} nu`, later && `${later} later`,
      vriezer && `${vriezer} naar de vriezer`].filter(Boolean).join(" · ");
  }
  const kookUit = i.van && kookVan(i)?.aan === false;
  const aan = actief(i);
  return `<div class="wr-gerecht voorstel${aan ? "" : " af"}" data-tid="${esc(i.tid)}">
    <span class="wr-voorsteltag">voorstel</span>
    <a class="wr-titel" href="#/recept/${esc(r.id)}">${esc(r.titel)}</a>
    <small class="wr-meta">${esc(meta)}</small>
    ${i.redenen?.length && aan ? `<small class="wr-reden">${esc(i.redenen.join(" · "))}</small>` : ""}
    ${kookUit ? `<small class="wr-meta">valt weg: het koken is afgewezen</small>` : `<span class="wr-keuze">
      <span class="janee" role="group" aria-label="Nemen?">
        <button type="button" class="mini" data-ja aria-pressed="${i.aan}" title="Nemen">✓</button><button type="button" class="mini" data-nee aria-pressed="${!i.aan}" title="Niet nemen">✗</button>
      </span>
      ${i.uit ? "" : `<button type="button" class="knop klein" data-ander>Ander gerecht</button>`}
    </span>`}
  </div>`;
}

// De balk boven het rooster zolang er een voorstel is.
export function voorstelBalk(data, laatsteDag) {
  const { opties, items } = voorstel;
  const aan = items.filter(actief);
  const koken = aan.filter((i) => !i.van && !i.uit).length;
  const lijst = boodschappenlijst({ ...data, menu: { gerechten: [...data.menu.gerechten, ...aan.map(naarMenu)] } });
  const teKopen = lijst.filter((x) => x.status === "kopen").length;
  const verder = items.some((i) => i.dag > laatsteDag);
  const eind = plusDagen(opties.begin, opties.dagen - 1);
  return `<div class="voorstelbalk">
    <p><b>Voorstel ${esc(datumNl(opties.begin))} – ${esc(datumNl(eind))}</b>: ${aan.length} van ${items.length} maaltijden,
      ${koken}× koken${aan.length ? ` · daarna ${teKopen} ${teKopen === 1 ? "ding" : "dingen"} op de boodschappenlijst` : ""}.</p>
    <p class="hint">Gestippeld = voorstel, er staat nog niets op het menu. Kies ✗ voor wat je niet wilt
      (dat vak blijft leeg), of "Ander gerecht".${verder ? " Een deel staat verder in de tijd: kijk met ›." : ""}</p>
    <div class="knoppen">
      <button class="knop primair" type="button" data-accepteer ${aan.length ? "" : "disabled"}>Aangevinkte op het menu zetten</button>
      <button class="knop" type="button" data-opnieuw>Opnieuw voorstellen</button>
      <button class="knop" type="button" data-stoppen>Annuleren</button>
    </div>
  </div>`;
}

// Een voorstel als gerecht op het menu (tid wordt later een echte id).
function naarMenu(i) {
  const { tid, aan, redenen, ...g } = i;
  return { id: tid, ...g };
}

async function accepteer(herteken) {
  const aan = voorstel.items.filter(actief);
  const ids = new Map(aan.map((i) => [i.tid, nieuwId()]));
  const nieuweIds = new Set(ids.values());
  const nieuw = aan.map((i) => {
    const g = naarMenu(i);
    g.id = ids.get(i.tid);
    if (g.van) g.van = ids.get(g.van);
    if (!g.van && !g.uit) {
      // 'eten' alleen bewaren als er een deel naar de vriezer gaat (anders volgt het uit de resten).
      const later = aan.filter((x) => x.van === i.tid).reduce((s, x) => s + x.porties, 0);
      if (g.eten + later >= g.porties) delete g.eten;
    }
    return g;
  });
  const d = await wijzig("menu", (doc) => { doc.gerechten.push(...nieuw); });
  voorstel = null;
  melding(`${nieuw.length} ${nieuw.length === 1 ? "maaltijd" : "maaltijden"} op het menu gezet`, () =>
    wijzig("menu", (doc) => { doc.gerechten = doc.gerechten.filter((g) => !nieuweIds.has(g.id)); }));
  herteken(d);
}

// Knoppen in het voorstel laten werken.
export function koppelVoorstel(main, data, herteken) {
  if (!voorstel) return;
  const opnieuw = () => herteken(data);
  main.querySelectorAll(".wr-gerecht.voorstel").forEach((el) => {
    const i = voorstel.items.find((x) => x.tid === el.dataset.tid);
    if (!i) return;
    el.querySelector("[data-ja]")?.addEventListener("click", () => { i.aan = true; opnieuw(); });
    el.querySelector("[data-nee]")?.addEventListener("click", () => { i.aan = false; opnieuw(); });
    el.querySelector("[data-ander]")?.addEventListener("click", () => {
      // Alleen dit vak (en bij een kookbeurt ook de resten ervan) opnieuw invullen; de rest blijft.
      const kook = !i.van && !i.uit;
      const weg = new Set([i.tid, ...(kook ? voorstel.items.filter((x) => x.van === i.tid).map((x) => x.tid) : [])]);
      const vast = voorstel.items.filter((x) => !weg.has(x.tid)).map((x) => ({ ...x, aan: actief(x) }));
      const uitgesloten = new Set(voorstel.uitgesloten);
      if (kook) uitgesloten.add(i.recept);
      maak(data, voorstel.opties, { ronde: voorstel.ronde, vast, uitgesloten });
      opnieuw();
    });
  });
  main.querySelector("[data-accepteer]")?.addEventListener("click", (e) => {
    e.target.disabled = true;
    accepteer(herteken).catch((err) => { e.target.disabled = false; fout(err); });
  });
  main.querySelector("[data-opnieuw]")?.addEventListener("click", () => {
    maak(data, voorstel.opties, { ronde: voorstel.ronde + 1 });
    opnieuw();
  });
  main.querySelector("[data-stoppen]")?.addEventListener("click", () => { voorstel = null; opnieuw(); });
}
