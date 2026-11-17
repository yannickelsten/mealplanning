import { alleenLezen, dataVersie, kijkElke, laad, laatsteEigenWijziging, soort } from "./store.js";
import { esc, melding } from "./util.js";
import { overzicht } from "./views/overzicht.js";
import { recept } from "./views/recept.js";
import { bewerken } from "./views/bewerken.js";
import { koken } from "./views/koken.js";
import { ingredientenLijst, ingredientForm } from "./views/ingredienten.js";
import { menu } from "./views/menu.js";
import { voorraad } from "./views/voorraad.js";
import { boodschappen } from "./views/boodschappen.js";
import { logboek } from "./views/logboek.js";
import { koppelScherm, telefoon } from "./views/telefoon.js";

// Op de telefoon (via GitHub) kunnen recepten niet bewerkt worden: zie store.js.
const opLaptop = (view) => (main, data, id) => alleenLezen
  ? (main.innerHTML = `<p class="waarschuwing los">Recepten bewerken kan op de laptop.</p>
      <a class="terug" href="${id ? `#/recept/${encodeURIComponent(id)}` : "#/"}">← Terug</a>`)
  : view(main, data, id);
document.body.classList.toggle("telefoon", soort === "github");
if (soort === "github") {
  document.querySelector('[data-nav="telefoon"]').textContent = "Koppeling";
  // Zodat de app ook zonder bereik opent.
  navigator.serviceWorker?.register("sw.js").catch(() => {});
}

// [patroon, pagina, menu-knop, bezig: niet vanzelf verversen (er wordt iets ingevuld)]
const ROUTES = [
  [/^#?\/?$/, overzicht, "recepten"],
  [/^#\/recept\/([^/]+)$/, recept, "recepten"],
  [/^#\/recept\/([^/]+)\/bewerken$/, opLaptop(bewerken), "recepten", true],
  [/^#\/nieuw-recept$/, opLaptop(bewerken), "recepten", true],
  [/^#\/recept\/([^/]+)\/koken$/, koken, "recepten", true],
  [/^#\/menu(?:\/(voorraad))?$/, menu, "menu"],
  [/^#\/voorraad$/, voorraad, "voorraad"],
  [/^#\/boodschappen$/, boodschappen, "boodschappen"],
  [/^#\/logboek$/, logboek, "logboek"],
  [/^#\/ingredienten$/, ingredientenLijst, "ingredienten"],
  [/^#\/ingredient\/([^/]+)$/, ingredientForm, "ingredienten", true],
  [/^#\/telefoon$/, telefoon, "telefoon", true],
];

const main = document.querySelector("main");
const problemen = document.querySelector("#problemen");
const route = () => {
  const hash = decodeURI(location.hash);
  const r = ROUTES.find(([re]) => re.test(hash)) || ROUTES[0];
  return [r, hash.match(r[0])?.slice(1) || []];
};

async function render() {
  const [[, view, nav], params] = route();
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("aan", a.dataset.nav === nav));
  try {
    const data = await laad();
    // Bestanden die niet ingelezen konden worden (bv. een tikfout in een recept van Claude).
    problemen.innerHTML = data.problemen?.length ? `<div class="waarschuwing los">
      <b>Niet alles kon worden ingelezen</b> (de rest werkt gewoon):
      <ul>${data.problemen.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      Vraag Claude om dit te repareren.</div>` : "";
    view(main, data, ...params);
  } catch (err) {
    if (err.koppelen) return koppelScherm(main, err.message);
    main.innerHTML = soort === "github"
      ? `<p class="waarschuwing">Kan de gegevens niet laden: ${esc(err.message)}.<br>
          Heb je bereik? Probeer het zo nog eens.</p>`
      : `<p class="waarschuwing">Kan de gegevens niet laden: ${esc(err.message)}.<br>
          Draait de server nog? Start hem opnieuw met de snelkoppeling <b>Mealplanning</b>.</p>`;
  }
}

// Scrollpositie per stap in de geschiedenis: met "terug" (of "vooruit") kom je weer waar je was;
// een nieuwe pagina via een link begint bovenaan. Elke stap krijgt een id (history.state.plek) en
// onthoudt van welke pagina je kwam (history.state.van); bij het wisselen staat de oude pagina nog
// op het scherm, dus dan wordt zijn positie bewaard: per stap, en per pagina (de laatste keer).
// In sessionStorage, zodat ook herladen op dezelfde plek uitkomt (lukt dat niet: gewoon bovenaan).
history.scrollRestoration = "manual";
const plekken = (() => { try { return JSON.parse(sessionStorage.getItem("plekken")) || {}; } catch { return {}; } })();
plekken.stap ||= {};
plekken.pagina ||= {};
let huidig = null; // [id, hash] van de pagina op het scherm
let terugModus = false;
const plekId = (van) => {
  if (!history.state?.plek) {
    history.replaceState({ ...history.state, plek: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), van }, "");
  }
  return [history.state.plek, location.hash];
};
const verlaat = () => { if (huidig) { plekken.stap[huidig[0]] = plekken.pagina[huidig[1]] = scrollY; } };
const naarPlek = () => {
  huidig = plekId(huidig?.[1]);
  const y = plekken.stap[huidig[0]] ?? (terugModus ? plekken.pagina[huidig[1]] : 0) ?? 0;
  terugModus = false;
  return render().then(() => window.scrollTo(0, y));
};
window.addEventListener("hashchange", () => { verlaat(); naarPlek(); });
window.addEventListener("pagehide", () => {
  verlaat();
  try { sessionStorage.setItem("plekken", JSON.stringify(plekken)); } catch { /* geen opslag: niet erg */ }
});
// Terug naar een pagina (knop "← Ingrediënten", na opslaan…): kwam je daar net vandaan, dan echt
// "terug" in de geschiedenis (op dezelfde plek, en de terugknop van de browser klopt daarna ook);
// anders erheen, op de plek waar je die pagina het laatst verliet.
function terug(hash) {
  if (hash === location.hash) return;
  if (history.state?.van === hash) return history.back();
  terugModus = true;
  location.hash = hash;
}
window.addEventListener("terug", (e) => terug(e.detail));
document.addEventListener("click", (e) => {
  const a = e.target.closest("a.terug");
  if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  terug(a.getAttribute("href"));
});
// Opnieuw tekenen zonder te scrollen (na "Ongedaan maken", zie melding in util.js).
window.addEventListener("tekenen", () => render());

// Mag de pagina nu vanzelf opnieuw getekend worden? Niet als er iets ingevuld wordt:
// formulieren, de kookstand, een open venster, of tekst in een invoerveld.
function bezig() {
  if (route()[0][3] || document.querySelector("dialog[open], details.dropdown[open]")) return true;
  const actief = document.activeElement;
  return !!(actief?.matches("input:not([type=checkbox]):not([type=search]), textarea, select") && actief.value);
}

// Terug naar dit venster: opnieuw inlezen.
window.addEventListener("focus", async () => {
  if (bezig()) return;
  try { await laad(true); render(); } catch { /* melding volgt bij volgende render */ }
});

// Elke paar seconden kijken of er in de map iets veranderd is (Claude schreef een recept,
// of een ander tabblad wijzigde iets). Zo ja: opnieuw inlezen en tonen.
let bekend = null;
async function kijk() {
  if (document.hidden) return;
  try {
    const v = await dataVersie();
    if (bekend && v !== bekend) {
      if (Date.now() - laatsteEigenWijziging() < 4000) {
        bekend = v; // eigen wijziging: staat al op het scherm
        return;
      }
      if (bezig()) return; // later opnieuw proberen
      await laad(true);
      render();
      melding("Bijgewerkt met nieuwe gegevens");
    }
    bekend = v;
  } catch { /* server even weg: volgende keer opnieuw */ }
}
setInterval(kijk, kijkElke);
// Telefoon: app weer geopend (uit de achtergrond) = meteen kijken.
document.addEventListener("visibilitychange", () => { if (!document.hidden) kijk(); });

naarPlek();
kijk();
