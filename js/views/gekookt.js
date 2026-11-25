import { wijzig } from "../store.js";
import { afboeken, afvinken, kookVerdeling, onderdelenAfnemen, restenVan, soortVan, toonPartijen, verbruik } from "../planning.js";
import { breuk, esc, melding, nieuwId, vandaag } from "../util.js";

// Wat er met de porties kan gebeuren. Basisrecepten (porties null: hoemoes, crispy tofu…)
// hebben geen porties, die verdeel je per keer dat je ze gemaakt hebt.
const VOOR_PORTIES = [["ik", "Zelf gegeten"], ["ander", "Door iemand anders gegeten"],
  ["koelkast", "In de koelkast"], ["vriezer", "In de vriezer"]];
const VOOR_BASIS = [["op", "Meteen opgebruikt"], ["koelkast", "In de koelkast"], ["vriezer", "In de vriezer"]];
// Waar een portie vandaan komt als je elders op + drukt terwijl alles al verdeeld is.
const BRONNEN = ["koelkast", "op", "ik", "vriezer", "ander"];

const som = (v) => Object.values(v).reduce((a, b) => a + b, 0);

// Beginstand van de verdeling. Staat het gerecht op het menu met resten voor later (of met
// een deel voor de vriezer), dan volgt die het plan: wat je nu eet, de resten in de koelkast,
// de rest in de vriezer. Eet je met meer mensen, dan is één portie van jou.
function beginVerdeling(n, basis, plan) {
  if (basis) return { koelkast: n };
  if (!plan || (!plan.resten && !plan.vriezer)) return { ik: Math.min(1, n), koelkast: Math.max(0, n - 1) };
  const nu = Math.min(n, plan.nu);
  const koelkast = Math.min(n - nu, plan.resten);
  const ik = Math.min(1, nu);
  return { ik, ander: nu - ik, koelkast, vriezer: n - nu - koelkast };
}

// Venster "Gekookt": zet het koken en wie wat gegeten heeft in het logboek, haalt de gebruikte
// ingrediënten uit de voorraad, zet bewaarde porties in de koelkast/vriezer en haalt het
// gerecht op het menu af (het blijft grijs staan). Daarna wordt `klaar(data)` aangeroepen.
export function gekookt({ data, recept, porties, keuze, menuId = null, klaar }) {
  const basis = !recept.porties;
  const soorten = basis ? VOOR_BASIS : VOOR_PORTIES;
  const opMenu = menuId && data.menu.gerechten.find((g) => g.id === menuId);
  const plan = opMenu ? kookVerdeling(opMenu, data.menu.gerechten) : null;
  let verdeling = beginVerdeling(porties, basis, plan);

  const dlg = document.createElement("dialog");
  dlg.className = "dialoog";
  dlg.innerHTML = `<form novalidate>
    <h2 class="dl-kop">Gekookt</h2>
    <p class="dl-titel">${esc(recept.titel)}${recept.ondertitel ? ` <small>${esc(recept.ondertitel)}</small>` : ""}</p>
    <div class="twee">
      <label class="veld"><span>Datum</span><input type="date" name="datum" value="${vandaag()}" max="${vandaag()}"></label>
      <label class="veld"><span>${basis ? "Keer gemaakt" : "Porties"}</span>
        <input type="number" name="porties" min="1" step="1" value="${porties}"></label>
    </div>
    <div>
      <span class="label">${basis ? "Wat heb je ermee gedaan?" : "Wat is er met de porties gebeurd?"}</span>
      <ul class="verdeling"></ul>
      <p class="dl-rest hint"></p>
    </div>
    <div class="dl-voorraad"></div>
    ${menuId ? `<label class="vink"><input type="checkbox" name="menu" checked> op het menu afvinken</label>` : ""}
    <p class="fout" hidden></p>
    <div class="knoppen"><button class="knop primair" type="submit">Opslaan</button>
      <button class="knop" type="button" data-annuleer>Annuleren</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector("form");
  const lijst = dlg.querySelector(".verdeling");
  const restEl = dlg.querySelector(".dl-rest");
  const box = dlg.querySelector(".dl-voorraad");
  const foutEl = dlg.querySelector(".fout");
  const opslaanKnop = form.querySelector("[type=submit]");
  const aantal = () => Math.max(1, Math.round(Number(form.porties.value) || 1));

  const toonVerdeling = () => {
    const n = aantal(), s = som(verdeling);
    lijst.innerHTML = soorten.map(([k, label]) => `<li><span>${label}</span>
      <span class="stapjes">
        <button type="button" class="stapper" data-k="${k}" data-d="-1" aria-label="Minder" ${verdeling[k] ? "" : "disabled"}>−</button>
        <b>${verdeling[k] || 0}</b>
        <button type="button" class="stapper" data-k="${k}" data-d="1" aria-label="Meer">+</button>
      </span></li>`).join("");
    restEl.textContent = s === n ? "" : s < n ? `Nog ${n - s} te verdelen.` : `${s - n} te veel verdeeld.`;
    opslaanKnop.disabled = s !== n;
  };

  // Zelfgemaakte onderdelen (crispy tofu, hoemoes) die al klaarstaan: gebruiken, tenzij uitgevinkt.
  let metOnderdelen = true;
  let lijstOpen = false; // het lijstje ingrediënten blijft open als je het opende
  // Vinkjes die je zelf veranderde, blijven zo (ook als het aantal porties verandert).
  const gekozen = new Map();
  const aan = (x) => (gekozen.has(x.slug) ? gekozen.get(x.slug) : !!x.na);
  const toonVoorraad = () => {
    const v = verbruik(recept, aantal(), keuze, data, metOnderdelen);
    const kan = metOnderdelen ? v.onderdelen : verbruik(recept, aantal(), keuze, data, true).onderdelen;
    // Ingedeeld: één regel "Uit de voorraad: ui, citroen, kikkererwten (+3) · aanpassen".
    const namen = v.filter(aan).map((x) => x.ing.naam.toLowerCase());
    box.innerHTML = `${kan.length ? `<span class="label">Al gemaakt</span>
      <ul class="dl-lijst"><li><label class="vink"><input type="checkbox" data-onderdelen ${metOnderdelen ? "checked" : ""}>
        <span>${esc(kan.map((o) => `${data.recepten[o.recept]?.titel || o.recept} (${breuk(o.keer)}×)`).join(", "))}</span>
        <small>uit de koelkast/vriezer gebruiken</small></label></li></ul>` : ""}
      ${v.length ? `<details class="dl-uitvoorraad"${lijstOpen ? " open" : ""}><summary>Uit de voorraad: ${esc(namen.slice(0, 3).join(", ") || "niets")}${
        namen.length > 3 ? ` (+${namen.length - 3})` : ""} · <span class="linkknop">aanpassen</span></summary>
      <ul class="dl-lijst">${v.map((x) => `<li><label class="vink">
        <input type="checkbox" data-slug="${esc(x.slug)}" ${aan(x) ? "checked" : ""}>
        <span>${esc(x.ing.naam)}</span>
        <small>${x.na
          ? `${esc(toonPartijen(x.voor, data))} → ${esc(toonPartijen(x.na, data))}`
          : "is op (uit de voorraad halen)"}</small></label></li>`).join("")}</ul></details>` : ""}`;
    box.querySelector("[data-onderdelen]")?.addEventListener("change", (e) => {
      metOnderdelen = e.target.checked;
      toonVoorraad();
    });
    box.querySelector("details")?.addEventListener("toggle", (e) => { lijstOpen = e.target.open; });
    box.querySelectorAll("input[data-slug]").forEach((i) => i.addEventListener("change", () => {
      gekozen.set(i.dataset.slug, i.checked);
      toonVoorraad();
    }));
  };

  toonVerdeling();
  toonVoorraad();
  form.porties.addEventListener("input", () => {
    verdeling = beginVerdeling(aantal(), basis, plan);
    toonVerdeling();
    toonVoorraad();
  });
  lijst.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    const k = b.dataset.k;
    if (b.dataset.d === "-1") {
      verdeling[k] = Math.max(0, (verdeling[k] || 0) - 1);
    } else {
      // Alles al verdeeld? Dan schuift er een portie van een andere bestemming hierheen.
      if (som(verdeling) >= aantal()) {
        const van = BRONNEN.find((x) => x !== k && verdeling[x] > 0);
        if (!van) return;
        verdeling[van]--;
      }
      verdeling[k] = (verdeling[k] || 0) + 1;
    }
    toonVerdeling();
  });
  dlg.querySelector("[data-annuleer]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => dlg.remove());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const datum = form.datum.value;
    const fout = (t) => { foutEl.textContent = t; foutEl.hidden = false; };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return fout("Kies een datum.");
    const n = aantal();
    if (som(verdeling) !== n) return fout("Verdeel eerst alle porties.");
    const v = Object.fromEntries(Object.entries(verdeling).filter(([, x]) => x > 0));
    const aan = new Set([...box.querySelectorAll("input[data-slug]:checked")].map((i) => i.dataset.slug));
    const alles = verbruik(recept, n, keuze, data, metOnderdelen);
    const bijwerken = alles.filter((x) => aan.has(x.slug));
    const onderdelen = metOnderdelen ? alles.onderdelen : [];
    const kookId = nieuwId();
    const metKeuze = keuze ? { keuze } : {};
    opslaanKnop.disabled = true;
    try {
      let d = await wijzig("logboek", (doc) => {
        doc.gekookt.push({ id: kookId, datum, recept: recept.id, porties: n, ...metKeuze, verdeling: v });
        for (const wie of ["ik", "ander"]) {
          if (v[wie]) doc.maaltijden.push({ id: nieuwId(), datum, recept: recept.id, porties: v[wie], door: wie, kookId, ...metKeuze });
        }
      });
      if (bijwerken.length || onderdelen.length || v.koelkast || v.vriezer) {
        d = await wijzig("voorraad", (doc) => {
          onderdelenAfnemen(doc.porties, onderdelen, data);
          for (const x of bijwerken) {
            // x.slug is de soort: alle merken daarvan doen mee.
            const vanSoort = (p) => soortVan(data, p.ingredient) === x.slug;
            const anders = doc.ingredienten.filter((p) => !vanSoort(p));
            if (!x.na) { doc.ingredienten = anders; continue; } // aangevinkt als 'op'
            // Opnieuw uitrekenen op de nieuwste voorraad (kan intussen gewijzigd zijn).
            doc.ingredienten = [...anders, ...afboeken(doc.ingredienten.filter(vanSoort), x.nodig, data, datum).partijen];
          }
          for (const plek of ["koelkast", "vriezer"]) {
            if (v[plek]) doc.porties.push({ id: nieuwId(), recept: recept.id, ...metKeuze, aantal: v[plek], plek, gekookt: datum, sinds: datum, kookId });
          }
        });
      }
      // De geplande resten liggen nu in de koelkast: die worden "uit de voorraad" eten.
      if (menuId && (form.menu.checked || restenVan(data.menu.gerechten, menuId).length)) {
        d = await wijzig("menu", (doc) => {
          for (const g of doc.gerechten) {
            if (g.van !== menuId) continue;
            delete g.van;
            g.uit = "voorraad";
          }
          if (form.menu.checked) afvinken(doc, menuId, datum);
        });
      }
      dlg.close();
      melding(v.koelkast || v.vriezer ? "In het logboek gezet, porties bewaard" : "In het logboek gezet");
      klaar(d);
    } catch (err) {
      fout(err.message);
      opslaanKnop.disabled = false;
    }
  });
  dlg.showModal();
}
