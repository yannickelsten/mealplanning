// Recept bewerken of nieuw maken. Slaat op via de server, in dezelfde opmaak als de
// bestanden die Claude schrijft.
import { bewaarRecept, laad, verwijderRecept } from "../store.js";
import { voeding } from "../voeding.js";
import { esc, melding, nl, slugVan, vandaag } from "../util.js";

const RECEPT_EENHEDEN = ["keer", "portie", "g", "kg", "ml", "l"];
const LEEG = () => ({ titel: "", ondertitel: "", porties: 2, tags: { keuken: [], vibe: [] }, variant_van: null,
  stappen: [{ ingredienten: [], instructie: "" }], notities: [], wijzigingen: [] });

// Naam van een recept in keuzelijsten; varianten met hun ondertitel erbij.
const receptLabel = (x) => `Recept: ${x.titel}${x.variant_van && x.ondertitel ? ` (${x.ondertitel})` : ""}`;

export function bewerken(main, data, id) {
  const origineel = id ? data.recepten[id] : null;
  if (id && !origineel) {
    main.innerHTML = `<p class="leeg-tekst">Recept niet gevonden. <a href="#/">Terug naar recepten</a></p>`;
    return;
  }
  const r = structuredClone(origineel || LEEG());
  let categorie = origineel?.categorie || "overige-gerechten";
  const terug = id ? `#/recept/${id}` : "#/";

  // Tekst in het koppelveld ↔ ingrediënt of recept.
  const ingOpNaam = new Map(Object.entries(data.ingredienten).map(([s, i]) => [i.naam.toLowerCase(), s]));
  const recOpNaam = new Map(Object.values(data.recepten).filter((x) => x.id !== id)
    .map((x) => [receptLabel(x).toLowerCase(), x.id]));
  const koppelTekst = (x) => (x.ingredient ? data.ingredienten[x.ingredient]?.naam || x.ingredient
    : x.recept ? (data.recepten[x.recept] ? receptLabel(data.recepten[x.recept]) : `Recept: ${x.recept}`) : "");
  const koppel = (tekst) => {
    const t = tekst.trim().toLowerCase();
    if (!t) return {};
    if (recOpNaam.has(t)) return { recept: recOpNaam.get(t) };
    if (ingOpNaam.has(t)) return { ingredient: ingOpNaam.get(t) };
    if (data.ingredienten[t]) return { ingredient: t };
    return null;
  };
  const alleTags = (soort) => [...new Set(Object.values(data.recepten).flatMap((x) => x.tags?.[soort] || []))]
    .sort((a, b) => a.localeCompare(b, "nl"));

  const eenheidOpties = (gekozen) => `<option value=""></option>${Object.keys(data.eenheden)
    .map((e) => `<option ${e === gekozen ? "selected" : ""}>${e}</option>`).join("")}`;
  const regelHtml = (x) => `<div class="regel" data-keuze="${esc(x.keuze || "")}">
    <input class="r-h" type="number" step="any" min="0" value="${x.hoeveelheid ?? ""}" aria-label="Hoeveelheid" placeholder="aantal">
    <select class="r-e" aria-label="Eenheid">${eenheidOpties(x.eenheid)}</select>
    <input class="r-k" list="b-koppel" value="${esc(koppelTekst(x))}" placeholder="ingrediënt of recept" aria-label="Ingrediënt of recept">
    <input class="r-n" value="${esc(x.naam || "")}" placeholder="naam op de kaart" aria-label="Naam zoals in het recept">
    <span class="r-knoppen"><button type="button" class="mini" data-actie="op" aria-label="Omhoog">↑</button><button type="button" class="mini" data-actie="neer" aria-label="Omlaag">↓</button><button type="button" class="mini" data-actie="weg" aria-label="Weghalen">×</button></span>
  </div>`;
  const regelsHtml = (lijst) => `<div class="regels">${lijst.map(regelHtml).join("")}</div>
    <button type="button" class="knop klein" data-actie="regel+">+ ingrediënt</button>`;

  function teken() {
    main.innerHTML = `
      <a class="terug" href="${terug}">← ${id ? "Terug naar het recept" : "Recepten"}</a>
      <h1 class="paginatitel">${id ? `${esc(origineel.titel)} bewerken` : "Nieuw recept"}</h1>
      ${origineel?.variant_van ? `<p class="hint">Variant van <a href="#/recept/${esc(origineel.variant_van)}">${esc(data.recepten[origineel.variant_van]?.titel || origineel.variant_van)}</a>.</p>` : ""}
      <form class="formulier bewerk" novalidate>
        <fieldset><legend>Algemeen</legend>
          <label class="veld"><span>Titel *</span><input name="titel" value="${esc(r.titel)}" required></label>
          <label class="veld"><span>Ondertitel</span><input name="ondertitel" value="${esc(r.ondertitel || "")}" placeholder="bv. met crispy tofu en witte bonen"></label>
          <div class="vier">
            <label class="veld"><span>Categorie</span><select name="categorie">${data.categorieen.map((c) =>
              `<option value="${esc(c.id)}" ${c.id === categorie ? "selected" : ""}>${esc(c.naam)}</option>`).join("")}</select></label>
            <label class="veld"><span>Porties</span><input name="porties" type="number" min="1" step="1" value="${r.porties ?? ""}">
              <small>leeg = basisrecept (crispy tofu, saus…)</small></label>
            <label class="veld"><span>Opbrengst (gram)</span><input name="opbrengst_g" type="number" min="0" step="any" value="${r.opbrengst_g ?? ""}">
              <small>optioneel, voor dips en baksels</small></label>
          </div>
          ${["keuken", "vibe"].map((soort) => `<label class="veld"><span>${soort === "keuken" ? "Keuken" : "Vibe"}</span>
            <input name="${soort}" value="${esc((r.tags?.[soort] || []).join(", "))}" placeholder="met komma's">
            <span class="tagkeuze" data-voor="${soort}">${alleTags(soort).map((t) => `<button type="button" class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}</span></label>`).join("")}
        </fieldset>

        <fieldset><legend>Ingrediënten en bereiding</legend>
          <p class="hint">Per stap de ingrediënten die erbij horen, en een zin die op zichzelf leesbaar is
            ("Tomatenpuree toevoegen…", niet "Toevoegen…"). Kies ingrediënten uit de lijst, of een ander recept
            ("Recept: Crispy Tofu") met eenheid keer, portie of gram.</p>
          ${r.stappen.map((st, i) => `<div class="stap" data-i="${i}">
            <div class="stapkop"><b>Stap ${i + 1}</b>
              <span class="r-knoppen"><button type="button" class="mini" data-actie="stap-op" aria-label="Stap omhoog">↑</button><button type="button" class="mini" data-actie="stap-neer" aria-label="Stap omlaag">↓</button><button type="button" class="mini" data-actie="stap-weg" aria-label="Stap weghalen">×</button></span></div>
            ${regelsHtml(st.ingredienten || [])}
            <label class="veld"><span>Instructie</span><textarea class="s-instructie" rows="2">${esc(st.instructie)}</textarea></label>
          </div>`).join("")}
          <button type="button" class="knop" data-actie="stap+">+ stap</button>
        </fieldset>

        <fieldset><legend>Keuzes (bv. specerijenmix)</legend>
          ${r.keuzes ? `<label class="veld"><span>Naam van de keuze</span><input name="keuzetitel" value="${esc(r.keuzes.titel || "")}"></label>
            ${(r.keuzes.opties || []).map((o, i) => `<div class="stap optie" data-i="${i}" data-id="${esc(o.id || "")}">
              <div class="stapkop"><b>Optie ${i + 1}</b>
                <span class="r-knoppen"><button type="button" class="mini" data-actie="optie-weg" aria-label="Optie weghalen">×</button></span></div>
              <div class="vier">
                <label class="veld"><span>Naam</span><input class="o-naam" value="${esc(o.naam || "")}"></label>
                <label class="veld"><span>Keuken</span><input class="o-keuken" value="${esc(o.keuken || "")}" placeholder="bv. Italiaans"></label>
              </div>
              ${regelsHtml(o.ingredienten || [])}
            </div>`).join("")}
            <button type="button" class="knop" data-actie="optie+">+ optie</button>`
            : `<p class="hint">Geen keuzes. Handig als je één onderdeel op verschillende manieren maakt.</p>
               <button type="button" class="knop" data-actie="keuzes+">+ keuzes toevoegen</button>`}
        </fieldset>

        <fieldset><legend>Notities</legend>
          <textarea name="notities" rows="3" placeholder="één notitie per regel">${esc((r.notities || []).join("\n"))}</textarea>
        </fieldset>

        <div class="voorproef" aria-live="polite"></div>
        ${id ? `<label class="veld"><span>Wat heb je veranderd?</span><input name="wat" placeholder="bv. meer knoflook, tofu vervangen door tempeh">
          <small>Komt bij de wijzigingen onderaan het recept.</small></label>` : ""}
        <p class="fout" hidden></p>
        <div class="knoppen">
          <button class="knop primair" type="submit">Opslaan</button>
          ${id ? `<button class="knop" type="button" data-actie="variant">Opslaan als variant…</button>` : ""}
          <a class="knop" href="${terug}">Annuleren</a>
          ${id ? `<button class="knop gevaar" type="button" data-actie="verwijder">Verwijderen</button>` : ""}
        </div>
      </form>
      <datalist id="b-koppel">${[...Object.values(data.ingredienten).map((i) => i.naam),
        ...Object.values(data.recepten).filter((x) => x.id !== id).map(receptLabel)]
        .sort((a, b) => a.localeCompare(b, "nl")).map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
    koppelGebeurtenissen();
    voorproef();
  }

  // Formulier → r. `streng`: fouten verzamelen (bij opslaan); anders onbekende regels overslaan.
  function lees(streng = false) {
    const form = main.querySelector("form");
    const fouten = [];
    const leesRegels = (doos, waar) => [...doos.querySelectorAll(":scope > .regels > .regel")].flatMap((el) => {
      const ht = el.querySelector(".r-h").value.trim();
      const h = ht === "" ? null : Number(ht.replace(",", "."));
      const e = el.querySelector(".r-e").value || null;
      const kt = el.querySelector(".r-k").value;
      const naam = el.querySelector(".r-n").value.trim();
      if (h == null && !e && !kt.trim() && !naam) return []; // lege regel
      const link = koppel(kt);
      if (!link) { fouten.push(`${waar}: "${kt.trim()}" staat niet in de lijst. Kies een ingrediënt of recept uit de lijst (of maak het eerst aan bij Ingrediënten).`); return []; }
      if ((h == null) !== (e == null)) fouten.push(`${waar}: ${naam || kt}: vul hoeveelheid én eenheid in, of geen van beide.`);
      if (h != null && !(h >= 0)) fouten.push(`${waar}: ${naam || kt}: ongeldige hoeveelheid.`);
      if (link.recept && e && !RECEPT_EENHEDEN.includes(e)) fouten.push(`${waar}: een recept gebruik je in keer, portie of gram.`);
      const regel = {};
      if (h != null) regel.hoeveelheid = h;
      if (e) regel.eenheid = e;
      if (link.ingredient) regel.ingredient = link.ingredient;
      if (link.recept) {
        regel.recept = link.recept;
        if (el.dataset.keuze) regel.keuze = el.dataset.keuze;
      }
      const standaardNaam = link.ingredient ? data.ingredienten[link.ingredient].naam : link.recept ? data.recepten[link.recept].titel : "";
      if (naam || standaardNaam) regel.naam = naam || standaardNaam;
      return regel.naam || regel.ingredient || regel.recept ? [regel] : [];
    });

    r.titel = form.titel.value.trim();
    r.ondertitel = form.ondertitel.value.trim();
    categorie = form.categorie.value;
    const p = form.porties.value.trim();
    r.porties = p === "" ? null : Math.max(1, Math.round(Number(p)));
    const og = form.opbrengst_g.value.trim();
    if (og === "") delete r.opbrengst_g; else r.opbrengst_g = Number(og.replace(",", "."));
    r.tags = { ...(r.tags || {}),
      keuken: form.keuken.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      vibe: form.vibe.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) };
    r.stappen = [...form.querySelectorAll(".stap:not(.optie)")].map((st, i) => ({
      ingredienten: leesRegels(st, `Stap ${i + 1}`),
      instructie: st.querySelector(".s-instructie").value.trim(),
    }));
    if (form.keuzetitel) {
      const opties = [...form.querySelectorAll(".optie")].map((o, i) => {
        const naam = o.querySelector(".o-naam").value.trim();
        const keuken = o.querySelector(".o-keuken").value.trim();
        if (streng && !naam) fouten.push(`Optie ${i + 1}: geef de optie een naam.`);
        return { id: o.dataset.id || slugVan(naam) || `optie-${i + 1}`, naam, ...(keuken ? { keuken } : {}),
          ingredienten: leesRegels(o, `Optie ${naam || i + 1}`) };
      });
      r.keuzes = { titel: form.keuzetitel.value.trim() || "Keuze", opties };
    }
    r.notities = form.notities.value.split("\n").map((n) => n.trim()).filter(Boolean);
    if (streng) {
      if (!r.titel) fouten.unshift("Geef het recept een titel.");
      r.stappen.forEach((st, i) => { if (!st.instructie && !st.ingredienten.length) fouten.push(`Stap ${i + 1} is leeg: vul hem in of haal hem weg.`); });
      if (!r.stappen.length) fouten.push("Een recept heeft minstens één stap.");
      if (r.keuzes && new Set(r.keuzes.opties.map((o) => o.id)).size !== r.keuzes.opties.length) fouten.push("Twee opties hebben dezelfde naam.");
    }
    return fouten;
  }

  // Voedingswaarde terwijl je typt.
  let wachten;
  function voorproef() {
    clearTimeout(wachten);
    wachten = setTimeout(() => {
      const el = main.querySelector(".voorproef");
      if (!el) return;
      lees(false);
      const t = voeding({ ...r, id: id || "nieuw" }, data);
      const per = r.porties ? `per portie ${nl(t.kcal / r.porties)} kcal · ${nl(t.eiwit / r.porties)} g eiwit`
        : r.opbrengst_g ? `per 100 g ${nl(t.kcal / r.opbrengst_g * 100)} kcal · ${nl(t.eiwit / r.opbrengst_g * 100, 1)} g eiwit` : "";
      el.innerHTML = `<span class="label">Voedingswaarde</span> totaal ${nl(t.kcal)} kcal · ${nl(t.eiwit)} g eiwit${per ? ` · <b>${per}</b>` : ""}
        ${t.onvolledig.size ? `<small> (zonder ${esc([...t.onvolledig].join(", "))})</small>` : ""}`;
    }, 250);
  }

  function koppelGebeurtenissen() {
    const form = main.querySelector("form");
    form.addEventListener("input", voorproef);
    form.addEventListener("change", voorproef);
    // Naam leeg? Dan alvast de naam van het gekozen ingrediënt/recept invullen.
    form.addEventListener("change", (e) => {
      if (!e.target.matches(".r-k")) return;
      const naamVeld = e.target.closest(".regel").querySelector(".r-n");
      const link = koppel(e.target.value);
      if (link && !naamVeld.value.trim()) {
        naamVeld.value = link.ingredient ? data.ingredienten[link.ingredient].naam : link.recept ? data.recepten[link.recept].titel : "";
      }
      if (link?.recept) {
        const eh = e.target.closest(".regel").querySelector(".r-e");
        if (!eh.value) eh.value = "keer";
      }
    });
    form.addEventListener("click", (e) => {
      const tag = e.target.closest("[data-tag]");
      if (tag) {
        const veld = form[tag.closest(".tagkeuze").dataset.voor];
        const nu = veld.value.split(",").map((t) => t.trim()).filter(Boolean);
        if (!nu.includes(tag.dataset.tag)) veld.value = [...nu, tag.dataset.tag].join(", ");
        return;
      }
      const b = e.target.closest("[data-actie]");
      if (!b) return;
      const actie = b.dataset.actie;
      if (actie === "variant") return variantDialoog();
      if (actie === "verwijder") return verwijder();
      // Wijziging in de opbouw: eerst alles inlezen, dan aanpassen en opnieuw tekenen.
      const regelEl = b.closest(".regel");
      const doos = b.closest(".stap");
      if (regelEl && ["op", "neer", "weg"].includes(actie)) {
        // Regels verschuiven in het scherm zelf, zodat wat je typte blijft staan.
        if (actie === "weg") regelEl.remove();
        else if (actie === "op" && regelEl.previousElementSibling) regelEl.previousElementSibling.before(regelEl);
        else if (actie === "neer" && regelEl.nextElementSibling) regelEl.nextElementSibling.after(regelEl);
        voorproef();
        return;
      }
      if (actie === "regel+") {
        doos.querySelector(".regels").insertAdjacentHTML("beforeend", regelHtml({}));
        doos.querySelector(".regels > .regel:last-child .r-h").focus();
        return;
      }
      lees(false);
      const i = Number(doos?.dataset.i);
      if (actie === "stap+") r.stappen.push({ ingredienten: [], instructie: "" });
      else if (actie === "stap-weg") {
        if (r.stappen.length === 1) return melding("Een recept heeft minstens één stap");
        r.stappen.splice(i, 1);
      } else if (actie === "stap-op" && i > 0) [r.stappen[i - 1], r.stappen[i]] = [r.stappen[i], r.stappen[i - 1]];
      else if (actie === "stap-neer" && i < r.stappen.length - 1) [r.stappen[i + 1], r.stappen[i]] = [r.stappen[i], r.stappen[i + 1]];
      else if (actie === "keuzes+") r.keuzes = { titel: "Specerijenmix", opties: [{ id: "", naam: "", ingredienten: [] }] };
      else if (actie === "optie+") r.keuzes.opties.push({ id: "", naam: "", ingredienten: [] });
      else if (actie === "optie-weg") {
        r.keuzes.opties.splice(i, 1);
        if (!r.keuzes.opties.length) delete r.keuzes;
      }
      teken();
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); opslaan(); });
  }

  const toonFout = (html) => {
    const el = main.querySelector(".fout");
    el.innerHTML = html;
    el.hidden = false;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  // Opslaan (ook als variant). nieuwId/extra bepalen waar het heen gaat.
  async function opslaan({ nieuwId = null, extra = null, forceer = false } = {}) {
    const fouten = lees(true);
    if (fouten.length) return toonFout(fouten.map(esc).join("<br>"));
    const doelId = nieuwId || id || slugVan(r.titel);
    if (!doelId) return toonFout("Geef het recept een titel.");
    if (!id && !nieuwId && data.recepten[doelId]) return toonFout(`Er bestaat al een recept "${esc(data.recepten[doelId].titel)}". Kies een andere titel.`);
    const uit = { ...structuredClone(r), ...(extra || {}) };
    if (nieuwId) delete uit._versie; // nieuw bestand: geen versie van het origineel meesturen
    if (!uit.ondertitel) delete uit.ondertitel;
    if (!uit.keuzes?.opties?.length) delete uit.keuzes;
    if (!extra) {
      const wat = main.querySelector("[name=wat]")?.value.trim();
      uit.wijzigingen = [...(r.wijzigingen || []), { datum: vandaag(), wat: id ? wat || "Aangepast in de app" : "Gemaakt in de app" }];
    }
    try {
      await bewaarRecept(doelId, categorie, uit, { forceer });
      await laad(true);
      melding(nieuwId ? "Variant opgeslagen" : "Opgeslagen");
      location.hash = `#/recept/${doelId}`;
    } catch (err) {
      if (!err.conflict || !id || nieuwId) return toonFout(esc(err.message));
      toonFout(`${esc(err.message)}<br>
        <button type="button" class="knop klein" data-forceer>Toch opslaan (overschrijft die wijziging)</button>
        <button type="button" class="knop klein" data-herlaad>Opnieuw laden (jouw wijzigingen gaan verloren)</button>`);
      main.querySelector("[data-forceer]").addEventListener("click", () => opslaan({ forceer: true }));
      main.querySelector("[data-herlaad]").addEventListener("click", async () => bewerken(main, await laad(true), id));
    }
  }

  function variantDialoog() {
    const basisId = origineel.variant_van || id;
    const basis = data.recepten[basisId];
    const dlg = document.createElement("dialog");
    dlg.className = "dialoog";
    dlg.innerHTML = `<form novalidate>
      <h2 class="dl-kop">Opslaan als variant</h2>
      <p class="hint">Het origineel (${esc(basis.titel)}) blijft zoals het was. De variant verschijnt als tabblad bij het recept.</p>
      <label class="veld"><span>Wat is er anders?</span><input name="verschil" placeholder="bv. met tempeh" required>
        <small>Komt als ondertitel, bv. "met tempeh" of "pittig".</small></label>
      <p class="fout" hidden></p>
      <div class="knoppen"><button class="knop primair" type="submit">Opslaan</button>
        <button class="knop" type="button" data-annuleer>Annuleren</button></div>
    </form>`;
    document.body.append(dlg);
    dlg.addEventListener("close", () => dlg.remove());
    dlg.querySelector("[data-annuleer]").addEventListener("click", () => dlg.close());
    dlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const verschil = e.target.verschil.value.trim();
      const fout = dlg.querySelector(".fout");
      const nieuw = `${basisId}-${slugVan(verschil.replace(/^met\s+/i, ""))}`;
      if (!slugVan(verschil)) { fout.textContent = "Beschrijf kort wat er anders is."; fout.hidden = false; return; }
      if (data.recepten[nieuw]) { fout.textContent = `Er is al een variant "${data.recepten[nieuw].ondertitel || nieuw}".`; fout.hidden = false; return; }
      dlg.close();
      const wat = main.querySelector("[name=wat]")?.value.trim();
      opslaan({ nieuwId: nieuw, extra: { ondertitel: verschil, variant_van: basisId,
        wijzigingen: [{ datum: vandaag(), wat: `Variant van ${basis.titel}: ${wat || verschil}` }] } });
    });
    dlg.showModal();
    dlg.querySelector("[name=verschil]").focus();
  }

  async function verwijder() {
    if (!confirm(`"${origineel.titel}${origineel.variant_van ? ` (${origineel.ondertitel})` : ""}" verwijderen?\nHet bestand gaat naar de map data/prullenbak, dus het is terug te halen.`)) return;
    try {
      await verwijderRecept(origineel);
      await laad(true);
      melding("Verwijderd (staat in de prullenbak)");
      location.hash = origineel.variant_van ? `#/recept/${origineel.variant_van}` : "#/";
    } catch (err) {
      toonFout(esc(err.message));
    }
  }

  teken();
}
