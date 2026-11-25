// Bewaarde porties (mealprep): lijst + wat je ermee kunt doen. Gebruikt op "Wat eten we?"
// en "Voorraad".
import { wijzig } from "../store.js";
import { BEWAARDAGEN, bewaardePorties, portieStatus } from "../planning.js";
import { breuk, datumNl, duur, esc, melding, nieuwId, vandaag } from "../util.js";
import { ikoon } from "../iconen.js";

const fout = (err) => melding(err.message);
const naar = (plek) => (plek === "koelkast" ? "vriezer" : "koelkast");

function titel(data, p) {
  return data.recepten[p.recept]?.titel || p.recept;
}

function aantalTekst(data, p) {
  const r = data.recepten[p.recept];
  if (r && !r.porties) return p.aantal !== 1 ? `${breuk(p.aantal)}×` : "";
  return `${breuk(p.aantal)} ${p.aantal === 1 ? "portie" : "porties"}`;
}

// Hoe lang al bewaard, kort ("3 d"); de hele zin in de tooltip.
function leeftijd(p) {
  const s = portieStatus(p);
  const lang = p.plek === "koelkast"
    ? (s.oud ? `al ${duur(s.dagen)} in de koelkast: op of weg?` : s.dagen ? `${duur(s.dagen)} in de koelkast` : "vandaag in de koelkast")
    : (s.oud ? `al ${duur(s.dagen)} in de vriezer` : s.dagen ? `${duur(s.dagen)} in de vriezer` : "vandaag ingevroren");
  const kort = s.dagen ? duur(s.dagen).replace(/ dagen?$/, " d").replace(/ weken$/, " wk").replace(/ maanden$/, " mnd") : "vandaag";
  return `<span class="badge${s.oud ? " waarsch" : ""}" title="${esc(lang)}">${ikoon(p.plek === "vriezer" ? "snowflake" : "refrigerator")}${esc(kort)}</span>`;
}

// Aantal bewaarde porties op een plek als tekst: "3 porties".
export function aantalPorties(data, plek) {
  const n = data.voorraad.porties.filter((p) => p.plek === plek).reduce((s, p) => s + p.aantal, 0);
  return `${n} ${n === 1 ? "portie" : "porties"}`;
}

// Porties die (bijna) te lang liggen, voor de "gauw opmaken"-melding.
export function oudePorties(data) {
  return data.voorraad.porties.filter((p) => {
    const s = portieStatus(p);
    return s.oud || (p.plek === "koelkast" && s.dagen >= BEWAARDAGEN.koelkast - 1);
  });
}

// Bewaarde porties als lijst; optioneel alleen één plek, één recept, een zoekterm en/of een filter.
export function portiesHtml(data, { plek = null, zoek = "", recept = null, filter = null } = {}) {
  const z = zoek.toLowerCase();
  const lijst = bewaardePorties(data).filter((p) => (!plek || p.plek === plek) && (!recept || p.recept === recept)
    && (!z || titel(data, p).toLowerCase().includes(z)) && (!filter || filter(p)));
  if (!lijst.length) return "";
  return `<ul class="portielijst">${lijst.map((p) => {
    const r = data.recepten[p.recept];
    const keuze = r?.keuzes?.opties?.find((o) => o.id === p.keuze)?.naam;
    const verhuisd = p.sinds !== p.gekookt;
    const eet = r && !r.porties ? "Op" : "Gegeten";
    return `<li data-portie="${esc(p.id)}" title="${esc(`gekookt ${datumNl(p.gekookt)}${verhuisd ? `, sinds ${datumNl(p.sinds)} in de ${p.plek}` : ""}`)}">
      <div class="pl-naam">
        ${r ? `<a href="#/recept/${esc(p.recept)}">${esc(r.titel)}</a>` : esc(p.recept)}
        <small>${[keuze, aantalTekst(data, p)].filter(Boolean).map(esc).join(" · ")}</small>
      </div>
      <span class="pl-leeftijd">${leeftijd(p)}</span>
      <span class="pl-acties">
        <button class="ikoonknop" data-actie="eten" title="${eet}" aria-label="${eet}">${ikoon(r && !r.porties ? "circle-check" : "utensils")}</button>
        <button class="ikoonknop" data-actie="verplaats" title="Naar de ${naar(p.plek)}" aria-label="Naar de ${naar(p.plek)}">${ikoon(naar(p.plek) === "vriezer" ? "snowflake" : "refrigerator")}</button>
        <button class="ikoonknop gevaar" data-actie="weg" aria-label="Weggegooid" title="Weggegooid">${ikoon("trash-2")}</button>
      </span>
    </li>`;
  }).join("")}</ul>`;
}

// Knoppen in een lijst van portiesHtml laten werken. `klaar(data)` tekent daarna opnieuw.
export function koppelPorties(root, data, klaar) {
  root.querySelectorAll(".portielijst [data-actie]").forEach((b) => b.addEventListener("click", () => {
    const p = data.voorraad.porties.find((x) => x.id === b.closest("li").dataset.portie);
    if (p) portieActie(data, p, b.dataset.actie, klaar);
  }));
}

// Eten / verplaatsen / weggooien van een bewaarde portie (vraagt zo nodig hoeveel en door wie).
export function portieActie(data, p, actie, klaar) {
  const basis = data.recepten[p.recept] && !data.recepten[p.recept].porties;
  // Eén portie verplaatsen of een basisrecept opmaken: geen vragen nodig.
  if (p.aantal === 1 && (actie === "verplaats" || (actie === "eten" && basis))) {
    return uitvoeren(data, p, actie, { n: 1 }).then(klaar, fout);
  }
  if (p.aantal === 1 && actie === "weg") return uitvoeren(data, p, actie, { n: 1 }).then(klaar, fout);
  portieDialoog(data, p, actie, basis, klaar);
}

function portieDialoog(data, p, actie, basis, klaar) {
  const eten = actie === "eten" && !basis;
  const kop = { eten: basis ? "Opgemaakt" : "Gegeten", verplaats: `Naar de ${naar(p.plek)}`, weg: "Weggegooid" }[actie];
  const dlg = document.createElement("dialog");
  dlg.className = "dialoog";
  dlg.innerHTML = `<form novalidate>
    <h2 class="dl-kop">${kop}</h2>
    <p class="dl-titel">${esc(titel(data, p))} <small>uit de ${p.plek}, ${esc(aantalTekst(data, p))}</small></p>
    ${p.aantal > 1 ? `<label class="veld"><span>Hoeveel?</span>
      <input type="number" name="n" min="1" max="${p.aantal}" step="1" value="${eten ? 1 : p.aantal}"></label>` : ""}
    ${eten ? `<div class="twee">
      <fieldset class="keuzerij"><legend>Door</legend>
        <label class="vink"><input type="radio" name="wie" value="ik" checked> mij</label>
        <label class="vink"><input type="radio" name="wie" value="ander"> iemand anders</label></fieldset>
      <label class="veld"><span>Datum</span><input type="date" name="datum" value="${vandaag()}" max="${vandaag()}" min="${p.gekookt}"></label>
    </div>` : ""}
    <p class="fout" hidden></p>
    <div class="knoppen"><button class="knop primair" type="submit">Opslaan</button>
      <button class="knop" type="button" data-annuleer>Annuleren</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form");
  dlg.querySelector("[data-annuleer]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => dlg.remove());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const n = form.n ? Math.round(Number(form.n.value)) : 1;
    const foutEl = form.querySelector(".fout");
    if (!(n >= 1 && n <= p.aantal)) {
      foutEl.textContent = `Kies 1 tot ${p.aantal}.`;
      foutEl.hidden = false;
      return;
    }
    const opties = { n, wie: form.wie?.value, datum: form.datum?.value || vandaag() };
    uitvoeren(data, p, eten ? "eten" : actie === "eten" ? "op" : actie, opties).then((d) => { dlg.close(); klaar(d); }, (err) => {
      foutEl.textContent = err.message;
      foutEl.hidden = false;
    });
  });
  dlg.showModal();
}

// eten: in het logboek + uit de voorraad; op/weg: alleen uit de voorraad; verplaats: andere plek.
// Altijd met "Ongedaan maken" in de melding.
async function uitvoeren(data, p, actie, { n, wie = "ik", datum = vandaag() }) {
  const basis = data.recepten[p.recept] && !data.recepten[p.recept].porties;
  if (actie === "eten" && basis) actie = "op";
  let d = data;
  const voor = data.voorraad.porties.filter((y) => y.recept === p.recept).map((y) => ({ ...y }));
  const logId = nieuwId();
  if (actie === "weg") {
    // Bijhouden wat er weggegooid wordt (overzicht op de pagina Logboek).
    d = await wijzig("logboek", (doc) => {
      doc.weggegooid.push({ id: logId, datum: vandaag(), recept: p.recept, aantal: n });
    });
  }
  if (actie === "eten") {
    d = await wijzig("logboek", (doc) => {
      doc.maaltijden.push({ id: logId, datum, recept: p.recept, porties: n, door: wie, uit: p.plek,
        ...(p.kookId ? { kookId: p.kookId } : {}), ...(p.keuze ? { keuze: p.keuze } : {}) });
    });
  }
  const terug = async () => {
    if (actie === "weg" || actie === "eten") {
      await wijzig("logboek", (doc) => {
        doc.weggegooid = doc.weggegooid.filter((x) => x.id !== logId);
        doc.maaltijden = doc.maaltijden.filter((x) => x.id !== logId);
      });
    }
    await wijzig("voorraad", (doc) => { doc.porties = [...doc.porties.filter((y) => y.recept !== p.recept), ...voor]; });
  };
  d = await wijzig("voorraad", (doc) => {
    const x = doc.porties.find((y) => y.id === p.id);
    if (!x) return;
    const neem = Math.min(n, x.aantal);
    if (actie === "verplaats") {
      const plek = naar(x.plek);
      const sinds = vandaag();
      const zelfde = doc.porties.find((y) => y.plek === plek && y.recept === x.recept && y.keuze === x.keuze
        && y.gekookt === x.gekookt && y.sinds === sinds && y.kookId === x.kookId);
      if (zelfde) zelfde.aantal += neem;
      else doc.porties.push({ ...x, id: nieuwId(), aantal: neem, plek, sinds });
    }
    x.aantal -= neem;
    if (x.aantal <= 0) doc.porties = doc.porties.filter((y) => y !== x);
  });
  const t = titel(data, p);
  melding({ eten: `${t}: smakelijk!`, op: `${t} is op`, weg: `${t} weggegooid`, verplaats: `${t} ligt nu in de ${naar(p.plek)}` }[actie], terug);
  return d;
}
