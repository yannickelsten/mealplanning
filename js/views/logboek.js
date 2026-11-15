// Logboek: wat je at (voeding per dag t.o.v. je doel), wat je kookte, en per ingrediënt wat je
// gebruikte, opmaakte en weggooide.
import { wijzig } from "../store.js";
import { benodigd, kookbeurtOpMenu, rond, toonHoeveelheid, voedingPerDag } from "../planning.js";
import { datumNl, esc, melding, nl, plusDagen, vandaag } from "../util.js";
import { gekookt } from "./gekookt.js";

const f = { periode: 14, logAlles: false };
const fout = (err) => melding(err.message);
const VERDELING_TEKST = { ik: "zelf gegeten", ander: "door iemand anders", koelkast: "in de koelkast",
  vriezer: "in de vriezer", op: "opgebruikt" };
const porties = (n, r) => (r && !r.porties ? `${n}×` : `${n} ${n === 1 ? "portie" : "porties"}`);

// Staafjes per dag met een stippellijn voor het doel. Eén reeks, dus geen legenda: de titel zegt wat het is.
function grafiek(titel, eenheid, dagen, sleutel, doel) {
  const waarden = dagen.map(([, d]) => d[sleutel]);
  const max = Math.max(doel || 0, ...waarden, 1) * 1.1;
  const om = Math.max(1, Math.round(dagen.length / 7)); // niet elke dag een label
  return `<figure class="grafiek">
    <figcaption class="g-titel">${titel}${doel ? ` <small>doel ${nl(doel)} ${eenheid}</small>` : ""}</figcaption>
    <div class="g-plot" role="img" aria-label="${esc(`${titel} per dag`)}">
      ${doel ? `<div class="g-doel" style="bottom:${(doel / max) * 100}%"><span>doel</span></div>` : ""}
      ${dagen.map(([dag, d]) => `<div class="g-kolom" tabindex="0"
        data-tip="${esc(`${datumNl(dag)}: ${d.maaltijden.length ? `${nl(d[sleutel])} ${eenheid}` : "niets gelogd"}`)}">
        ${d[sleutel] > 0 ? `<div class="g-staaf${doel && d[sleutel] > doel ? " boven" : ""}" style="height:${(d[sleutel] / max) * 100}%"></div>` : ""}
      </div>`).join("")}
    </div>
    <div class="g-as">${dagen.map(([dag], i) => `<span>${i % om === 0 || i === dagen.length - 1
      ? esc(new Date(`${dag}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "numeric" })) : ""}</span>`).join("")}</div>
  </figure>`;
}

export function logboek(main, data) {
  const herteken = (d) => logboek(main, d);
  const nu = vandaag();
  const doelen = data.instellingen.doelen || {};

  // Voeding
  const perDag = Object.entries(voedingPerDag(data, plusDagen(nu, -(f.periode - 1)), nu));
  const metEten = perDag.filter(([, d]) => d.maaltijden.length);
  const gem = (k) => (metEten.length ? metEten.reduce((s, [, d]) => s + d[k], 0) / metEten.length : 0);
  const tegel = (label, waarde, eenheid, doel) => `<div class="stat">
    <span class="label">${label}</span>
    <span class="stat-getal">${nl(waarde)}<small> ${eenheid}</small></span>
    <span class="hint">${doel ? `doel ${nl(doel)} ${eenheid} · ${nl((waarde / doel) * 100)}%` : "nog geen doel ingesteld"}</span>
  </div>`;

  // Logboek: koken en eten door elkaar, nieuwste eerst. Wat je bij het koken meteen at,
  // staat al in de regel van het koken.
  const log = [
    ...data.logboek.gekookt.map((k) => ({ ...k, soort: "gekookt" })),
    ...data.logboek.maaltijden.filter((m) => !(m.kookId && !m.uit)).map((m) => ({ ...m, soort: "gegeten" })),
  ].sort((a, b) => b.datum.localeCompare(a.datum) || b.id.localeCompare(a.id));
  const logZichtbaar = f.logAlles ? log : log.slice(0, 15);

  // Weggegooid, laatste 90 dagen: wat het vaakst?
  const weg = data.logboek.weggegooid.filter((w) => w.datum >= plusDagen(nu, -89))
    .sort((a, b) => b.datum.localeCompare(a.datum));
  const wegNaam = (w) => (w.recept ? data.recepten[w.recept]?.titel || w.recept : data.ingredienten[w.ingredient]?.naam || w.ingredient);
  const vaakst = Object.entries(weg.reduce((m, w) => ({ ...m, [wegNaam(w)]: (m[wegNaam(w)] || 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Ingrediënten: wat je in de gekozen periode kookte (uit de recepten berekend), wat je als
  // "op" markeerde en wat er weggegooid is.
  const vanaf = plusDagen(nu, -(f.periode - 1));
  const kookbeurten = data.logboek.gekookt.filter((k) => k.datum >= vanaf && k.datum <= nu && data.recepten[k.recept]);
  const gebruikt = [...benodigd(kookbeurten, data).values()].map((x) => ({
    ...x, keer: kookbeurten.filter((k) => benodigd([k], data).has(x.slug)).length,
  })).sort((a, b) => b.keer - a.keer || a.ing.naam.localeCompare(b.ing.naam, "nl"));
  const opgemaakt = (data.logboek.opgemaakt || []).filter((o) => o.datum >= plusDagen(nu, -89))
    .sort((a, b) => b.datum.localeCompare(a.datum));
  const ingNaam = (s) => data.ingredienten[s]?.naam || s;
  // Een regel uit 'weggegooid' of 'opgemaakt' weghalen (met ongedaan maken).
  const regelWeg = (lijstNaam, id) => {
    const regel = data.logboek[lijstNaam].find((x) => x.id === id);
    wijzig("logboek", (doc) => { doc[lijstNaam] = doc[lijstNaam].filter((x) => x.id !== id); }).then((d) => {
      melding("Uit het logboek gehaald", () => wijzig("logboek", (doc) => { (doc[lijstNaam] ||= []).push(regel); }));
      herteken(d);
    }, fout);
  };

  main.innerHTML = `
    <h1 class="paginatitel">Logboek</h1>

    <section class="blokje">
      <div class="kopregel"><h2 class="kop2">Wat je at</h2>
        <span class="chipgroep">${[7, 14, 30].map((n) =>
          `<button class="chip${f.periode === n ? " aan" : ""}" data-periode="${n}">${n} dagen</button>`).join("")}</span></div>
      <div class="stats">
        ${tegel("Gemiddeld per dag", gem("kcal"), "kcal", doelen.kcal)}
        ${tegel("Eiwit per dag", gem("eiwit"), "g", doelen.eiwit)}
        <div class="stat"><span class="label">Dagen met iets gelogd</span>
          <span class="stat-getal">${metEten.length}<small> van ${f.periode}</small></span>
          <span class="hint">gemiddelden tellen alleen die dagen</span></div>
      </div>
      <div class="grafieken">
        ${grafiek("Energie", "kcal", perDag, "kcal", doelen.kcal)}
        ${grafiek("Eiwit", "g", perDag, "eiwit", doelen.eiwit)}
      </div>
      <p class="hint">Alleen wat je zelf at en in het logboek staat (porties van recepten). Ontbijt, lunch
        en snacks tellen mee als je ze logt. Oude regels van vóór 15 nov tellen als 1 portie.</p>
      <form class="doelen">
        <span class="label">Doel per dag</span>
        <label class="veld"><span>kcal</span><input name="kcal" type="number" min="0" step="10" value="${doelen.kcal ?? ""}"></label>
        <label class="veld"><span>eiwit (g)</span><input name="eiwit" type="number" min="0" step="1" value="${doelen.eiwit ?? ""}"></label>
        <button class="knop klein" type="submit">Opslaan</button>
      </form>
    </section>

    <section class="blokje">
      <h2 class="kop2">Gekookt en gegeten</h2>
      <div class="log-toevoegen">
        <select id="log-recept" aria-label="Recept"><option value="">Iets gekookt dat niet op het menu stond? Kies een recept…</option>
          ${data.categorieen.map((c) => {
            const rs = Object.values(data.recepten).filter((r) => r.categorie === c.id)
              .sort((a, b) => a.titel.localeCompare(b.titel, "nl") || (a.variant_van ? 1 : -1));
            return rs.length ? `<optgroup label="${esc(c.naam)}">${rs.map((r) =>
              `<option value="${esc(r.id)}">${esc(r.titel)}${r.variant_van && r.ondertitel ? ` (${esc(r.ondertitel)})` : ""}</option>`).join("")}</optgroup>` : "";
          }).join("")}</select>
        <button class="knop" id="log-knop">Gekookt…</button>
      </div>
      ${log.length ? `<ul class="loglijst">${logZichtbaar.map((m) => {
        const r = data.recepten[m.recept];
        let wat;
        if (m.soort === "gekookt") {
          const v = Object.entries(m.verdeling || {}).filter(([, n]) => n > 0);
          wat = `${porties(m.porties, r)}${v.length ? `: ${v.map(([k, n]) => `${n} ${VERDELING_TEKST[k]}`).join(", ")}` : ""}`;
        } else {
          wat = [m.porties && porties(m.porties, r), m.door === "ander" && "door iemand anders", m.uit && `uit de ${m.uit}`]
            .filter(Boolean).join(" ");
        }
        return `<li data-log="${esc(m.id)}" data-soort="${m.soort}"><time>${esc(datumNl(m.datum))}</time>
          <span class="log-soort ${m.soort}">${m.soort}</span>
          <span class="log-wat">${r ? `<a href="#/recept/${esc(r.id)}">${esc(r.titel)}</a>${r.variant_van && r.ondertitel ? ` <small>${esc(r.ondertitel)}</small>` : ""}`
            : `<span>${esc(m.recept)}</span> <small>(recept bestaat niet meer)</small>`}
          ${wat ? `<small>${esc(wat)}</small>` : ""}</span>
          <button class="kruisje" data-logweg aria-label="Uit het logboek halen" title="Uit het logboek halen">×</button></li>`;
      }).join("")}</ul>
        ${log.length > logZichtbaar.length ? `<button class="chip leeg" data-logalles>Alles tonen (${log.length})</button>` : ""}`
        : `<p class="leeg-tekst">Nog niets gelogd. Klik na het koken op "Gekookt", dan weet de app wat je lang niet hebt gehad.</p>`}
    </section>

    <section class="blokje">
      <h2 class="kop2">Ingrediënten</h2>
      <h3 class="subkop">Gebruikt bij het koken <small class="hint">laatste ${f.periode} dagen, uit de recepten berekend</small></h3>
      ${gebruikt.length ? `<ul class="verbruik">${gebruikt.map((x) => `<li title="${esc([...x.recepten].join(", "))}">
          <span>${esc(x.ing.naam)}</span>
          <small>${x.nodig.length ? esc(toonHoeveelheid(x.nodig.map((q) => ({ ...q, hoeveelheid: rond(q.hoeveelheid, q.eenheid, data.eenheden) })), data.eenheden, x.ing)) : ""}${x.keer > 1 ? ` · ${x.keer}×` : ""}</small></li>`).join("")}</ul>
        <p class="hint">Hiermee schat de app ook wanneer iets dat "in huis" is (olie, sauzen, kruiden) bijna op is.</p>`
        : `<p class="leeg-tekst">In deze periode niets gekookt.</p>`}
      <h3 class="subkop">Op <small class="hint">laatste 3 maanden</small></h3>
      ${opgemaakt.length ? `<ul class="loglijst">${opgemaakt.slice(0, 20).map((o) => `<li data-op="${esc(o.id)}"><time>${esc(datumNl(o.datum))}</time>
          <span class="log-soort">op</span><span class="log-wat">${esc(ingNaam(o.ingredient))}${o.niet_kopen ? " <small>niet opnieuw kopen</small>" : ""}</span>
          <button class="kruisje" data-opweg aria-label="Uit het logboek halen" title="Uit het logboek halen">×</button></li>`).join("")}</ul>`
        : `<p class="leeg-tekst">Nog niets. Is iets op, klik dan op "Op" bij <a href="#/voorraad">Voorraad</a>: dan komt het ook op de boodschappenlijst.</p>`}
      <h3 class="subkop">Weggegooid <small class="hint">laatste 3 maanden</small></h3>
      ${weg.length ? `${vaakst.some(([, n]) => n > 1) ? `<p>Het vaakst: ${vaakst.filter(([, n]) => n > 1).map(([naam, n]) => `${esc(naam)} (${n}×)`).join(", ")}.</p>` : ""}
        <ul class="loglijst">${weg.slice(0, 20).map((w) => `<li data-weg="${esc(w.id)}"><time>${esc(datumNl(w.datum))}</time>
          <span class="log-soort">${w.recept ? "portie" : "ingrediënt"}</span>
          <span class="log-wat">${esc(wegNaam(w))}
            <small>${w.aantal ? esc(porties(w.aantal, data.recepten[w.recept])) : w.hoeveelheid != null ? `${nl(w.hoeveelheid, 2)} ${esc(w.eenheid)}` : ""}</small></span>
          <button class="kruisje" data-wegweg aria-label="Uit het logboek halen" title="Uit het logboek halen">×</button></li>`).join("")}</ul>`
        : `<p class="leeg-tekst">Niets weggegooid, of nog niet bijgehouden. Gooi je iets weg, gebruik dan het × bij
          <a href="#/voorraad">Voorraad</a> (en niet "Op"), dan zie je hier wat er vaak bederft.</p>`}
    </section>`;

  main.querySelectorAll("[data-opweg]").forEach((b) => b.addEventListener("click", () => regelWeg("opgemaakt", b.closest("li").dataset.op)));
  main.querySelectorAll("[data-wegweg]").forEach((b) => b.addEventListener("click", () => regelWeg("weggegooid", b.closest("li").dataset.weg)));

  main.querySelectorAll("[data-periode]").forEach((b) => b.addEventListener("click", () => {
    f.periode = Number(b.dataset.periode);
    herteken(data);
  }));
  main.querySelector(".doelen").addEventListener("submit", (e) => {
    e.preventDefault();
    const getal = (n) => { const v = Number(e.target[n].value); return v > 0 ? v : null; };
    wijzig("instellingen", (doc) => {
      doc.doelen = Object.fromEntries([["kcal", getal("kcal")], ["eiwit", getal("eiwit")]].filter(([, v]) => v != null));
    }).then((d) => { melding("Doel opgeslagen"); herteken(d); }, fout);
  });

  main.querySelector("#log-knop").addEventListener("click", () => {
    const r = data.recepten[main.querySelector("#log-recept").value];
    if (!r) return melding("Kies eerst een recept");
    const g = kookbeurtOpMenu(data, r.id);
    gekookt({ data, recept: r, porties: g?.porties || r.porties || 1, keuze: g?.keuze || r.keuzes?.opties?.[0]?.id,
      menuId: g?.id, klaar: herteken });
  });
  main.querySelectorAll("[data-logweg]").forEach((b) => b.addEventListener("click", async () => {
    const li = b.closest("li");
    const id = li.dataset.log;
    const m = log.find((x) => x.id === id);
    const titel = data.recepten[m.recept]?.titel || m.recept;
    if (li.dataset.soort === "gegeten") {
      if (!confirm(`${titel} (${datumNl(m.datum)}) uit het logboek halen?`)) return;
      return wijzig("logboek", (doc) => { doc.maaltijden = doc.maaltijden.filter((x) => x.id !== id); }).then(herteken, fout);
    }
    // Koken weghalen = alsof het niet gebeurd is: ook wat je toen at en de porties die
    // er nog van bewaard liggen. (Gebruikte ingrediënten komen niet terug in de voorraad.)
    const nogBewaard = data.voorraad.porties.filter((p) => p.kookId === id).reduce((s, p) => s + p.aantal, 0);
    if (!confirm(`${titel} gekookt op ${datumNl(m.datum)} uit het logboek halen?`
      + (nogBewaard ? `\nDe ${nogBewaard} bewaarde ${nogBewaard === 1 ? "portie" : "porties"} hiervan ${nogBewaard === 1 ? "verdwijnt" : "verdwijnen"} ook uit de voorraad.` : ""))) return;
    try {
      let d = await wijzig("logboek", (doc) => {
        doc.gekookt = doc.gekookt.filter((x) => x.id !== id);
        doc.maaltijden = doc.maaltijden.filter((x) => !(x.kookId === id && !x.uit));
      });
      if (nogBewaard) d = await wijzig("voorraad", (doc) => { doc.porties = doc.porties.filter((p) => p.kookId !== id); });
      herteken(d);
    } catch (err) {
      fout(err);
    }
  }));
  main.querySelector("[data-logalles]")?.addEventListener("click", () => { f.logAlles = true; herteken(data); });
}
