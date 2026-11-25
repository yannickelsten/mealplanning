// "Kies een gerecht" voor één vak van het weekrooster, en "Wanneer?" om een recept in te plannen.
// Beide vensters kiezen alleen; wat er dan op het menu komt, regelt de aanroeper (menu.js).
import { MOMENTEN, MOMENT_NAAM, bewaardPerGerecht, dezeWeek, eersteVrijVak, gerechtScore, laatstGegeten, momentVan,
  momentenVan, redenenVoor, restKandidaten } from "../planning.js";
import { datumNl, esc, plusDagen, vandaag, weekdag } from "../util.js";
import { ikoon } from "../iconen.js";

const receptNaam = (r) => `${r.titel}${r.variant_van && r.ondertitel ? ` (${r.ondertitel})` : ""}`;

function venster(html) {
  const dlg = document.createElement("dialog");
  dlg.className = "dialoog";
  dlg.innerHTML = html;
  document.body.append(dlg);
  dlg.addEventListener("close", () => dlg.remove());
  dlg.querySelector("[data-annuleer]")?.addEventListener("click", () => dlg.close());
  return dlg;
}

// Kiesvenster voor vak (dag, moment). `kies({soort, id})` met soort "r" (recept koken), "v" (een
// bewaarde portie opeten), "k" (rest van een kookbeurt op het menu) of "elders".
// Bovenaan wat het meest voor de hand ligt: resten, wat klaarstaat, en voorstellen met redenen
// (dezelfde score als de suggesties en het weekplan). Daaronder alles, met zoeken.
export function kiesGerecht(data, dag, moment, kies) {
  const resten = restKandidaten(data, dag, moment);
  // Wat klaarstaat, per recept (zoals bewaard: een variant blijft een variant).
  const bewaardPer = {};
  for (const p of data.voorraad.porties) {
    if (!data.recepten[p.recept]) continue;
    const x = (bewaardPer[p.recept] ||= { koelkast: 0, vriezer: 0 });
    x[p.plek] += p.aantal;
  }
  const bewaard = Object.keys(bewaardPer);
  const alKlaar = bewaardPerGerecht(data); // per basisrecept: die hoef je niet voor te stellen
  const onderdeel = new Set(data.categorieen.filter((c) => c.onderdeel).map((c) => c.id));
  const past = (r) => momentenVan(r, data).includes(moment);
  // Voorgesteld: gerechten die bij dit moment passen, nog niet op het menu, beste score eerst.
  const opMenu = new Set(data.menu.gerechten.filter((g) => !g.gegeten && g.recept).map((g) => data.recepten[g.recept]?.variant_van || g.recept));
  const ctx = { week: dezeWeek(data), laatst: laatstGegeten(data), dag, metVoorraad: data.voorraad.ingredienten.length > 0, cache: new Map() };
  const voorgesteld = Object.values(data.recepten)
    .filter((r) => !r.variant_van && !onderdeel.has(r.categorie) && r.porties && past(r) && !opMenu.has(r.id) && !alKlaar[r.id])
    .map((r) => ({ r, ...gerechtScore(r, data, ctx) }))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  let alles = false; // ook wat niet bij dit moment past

  const item = (waarde, titel, uitleg = "") => `<li><button type="button" class="kz-item" data-kies="${esc(waarde)}">
    <span class="kz-titel">${esc(titel)}</span>${uitleg ? `<small>${esc(uitleg)}</small>` : ""}</button></li>`;
  const blok = (kop, items) => (items.length ? `<h3 class="kz-kop">${esc(kop)}</h3><ul class="kz-lijst">${items.join("")}</ul>` : "");
  const dlg = venster(`<div class="kiezer">
    <h2 class="dl-kop">${esc(MOMENT_NAAM[moment])} <small>${esc(datumNl(dag))}</small></h2>
    <label class="zoekveld">${ikoon("search")}<input type="search" class="kz-zoek" placeholder="Zoek een recept…" aria-label="Zoek een recept" autocomplete="off"></label>
    <div class="kz-inhoud"></div>
    <div class="knoppen"><button class="knop" type="button" data-kies="elders:">${ikoon("ban")}Ik eet elders</button>
      <button class="knop" type="button" data-annuleer>Annuleren</button></div>
  </div>`);
  const inhoud = dlg.querySelector(".kz-inhoud");
  const zoek = dlg.querySelector(".kz-zoek");

  const teken = () => {
    const z = zoek.value.trim().toLowerCase();
    const treft = (r) => !z || `${r.titel} ${r.ondertitel || ""}`.toLowerCase().includes(z);
    const lijst = Object.values(data.recepten).filter((r) => treft(r) && (alles || z || past(r)))
      .sort((a, b) => a.titel.localeCompare(b.titel, "nl") || (a.variant_van ? 1 : -1));
    const perCategorie = data.categorieen.map((c) => blok(c.naam, lijst.filter((r) => r.categorie === c.id)
      .map((r) => item(`r:${r.id}`, receptNaam(r), past(r) ? "" : `past normaal bij ${momentenVan(r, data).map((m) => MOMENT_NAAM[m].toLowerCase()).join(", ") || "geen maaltijd"}`))));
    inhoud.innerHTML = (z ? "" : blok("Rest van wat je kookt", resten.map((k) => item(`k:${k.id}`, data.recepten[k.recept].titel,
        `gekookt ${weekdag(k.dag).toLowerCase()} ${MOMENT_NAAM[momentVan(k, data)].toLowerCase()}`)))
      + blok("Klaar in de koelkast of vriezer", bewaard.map((id) => item(`v:${id}`, data.recepten[id].titel,
        [bewaardPer[id].koelkast && `${bewaardPer[id].koelkast} in de koelkast`, bewaardPer[id].vriezer && `${bewaardPer[id].vriezer} in de vriezer`].filter(Boolean).join(", "))))
      + blok("Voorgesteld", voorgesteld.map((x) => item(`r:${x.r.id}`, x.r.titel,
        redenenVoor(x.r, x.l, x.dek, ctx.metVoorraad, dag, x.actie).join(" · ")))))
      + (perCategorie.join("") || `<p class="leeg-tekst">Geen recept gevonden.</p>`)
      + (!z && !alles ? `<p><button type="button" class="linkknop" data-alles>Ook gerechten die niet bij ${esc(MOMENT_NAAM[moment].toLowerCase())} passen</button></p>` : "");
    inhoud.querySelector("[data-alles]")?.addEventListener("click", () => { alles = true; teken(); });
  };
  teken();
  zoek.addEventListener("input", teken);
  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-kies]");
    if (!b) return;
    const [soort, id] = b.dataset.kies.split(":");
    dlg.close();
    kies({ soort, id });
  });
  dlg.showModal();
  // Op de telefoon niet meteen het toetsenbord over de lijst heen.
  if (matchMedia("(pointer: coarse)").matches) zoek.blur();
}

// "Wanneer?": dag en moment voor een recept, met het eerste vrije vak dat bij het recept past al
// gekozen. `kies({dag, moment})`.
export function wanneer(data, recept, kies) {
  const vak = eersteVrijVak(data, recept);
  const dagen = Array.from({ length: 14 }, (_, n) => plusDagen(vandaag(), n));
  const past = momentenVan(recept, data);
  const dlg = venster(`<form novalidate>
    <h2 class="dl-kop">Wanneer?</h2>
    <p class="dl-titel">${esc(receptNaam(recept))}</p>
    <div class="twee">
      <label class="veld"><span>Dag</span><select name="dag">${dagen.map((d) =>
        `<option value="${d}" ${d === vak.dag ? "selected" : ""}>${esc(datumNl(d))}${d === vandaag() ? " (vandaag)" : ""}</option>`).join("")}</select></label>
      <label class="veld"><span>Maaltijd</span><select name="moment">${MOMENTEN.map(([m, naam]) =>
        `<option value="${m}" ${m === vak.moment ? "selected" : ""}>${naam}${past.length && !past.includes(m) ? " (past normaal niet)" : ""}</option>`).join("")}</select></label>
    </div>
    <div class="knoppen"><button class="knop primair" type="submit">${ikoon("calendar-plus")}Op het menu</button>
      <button class="knop" type="button" data-annuleer>Annuleren</button></div>
  </form>`);
  const form = dlg.querySelector("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    dlg.close();
    kies({ dag: form.dag.value, moment: form.moment.value });
  });
  dlg.showModal();
  form.querySelector("[type=submit]").focus();
}
