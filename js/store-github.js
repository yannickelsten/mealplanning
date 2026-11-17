// Op de telefoon: de data staat in de privé-repository "mealplanning-data" op GitHub. De
// laptop houdt die gelijk met de OneDrive-map (tools/sync.py). Zie store.js.
//
// - Wat er op GitHub staat wordt in de telefoon bewaard (IndexedDB), zodat de app ook zonder
//   bereik opent. Alleen gewijzigde bestanden worden opnieuw opgehaald.
// - Opslaan gaat per bestand, met de versie (sha) die we hadden: is het intussen ergens anders
//   gewijzigd, dan halen we de nieuwste versie en passen de wijziging opnieuw toe (net als op
//   de laptop). Zonder bereik wachten wijzigingen tot er weer verbinding is.
// - Recepten bewerken kan alleen op de laptop (daar controleert de server ze).

export const soort = "github";
export const alleenLezen = true;
export const kijkElke = 30000;
export let laatsteEigenWijziging = 0;

const API = "https://api.github.com";
const REPO = "mealplanning-data";
const TAK = "main";
const AUTEUR = { name: "Mealplanning", email: "mealplanning@users.noreply.github.com" };
const SLEUTEL = "mealplanning-github";
const DATAPAD = /^data\/(recepten\/[^/]+\/)?[^/]+\.json$/;
const VAST = ["ingredienten", "eenheden", "categorieen", "bewaren", "aanbiedingen"];
// Dezelfde lege beginstand als PLANBESTANDEN in tools/mealdata.py.
const PLAN = {
  logboek: () => ({ maaltijden: [], gekookt: [], weggegooid: [], opgemaakt: [] }),
  voorraad: () => ({ ingredienten: [], porties: [] }),
  menu: () => ({ gerechten: [] }),
  boodschappen: () => ({ extra: [], afgevinkt: [] }),
  instellingen: () => ({ doelen: {}, minimum: {} }),
};

const eigen = () => { laatsteEigenWijziging = Date.now(); };
const slaap = (ms) => new Promise((ok) => setTimeout(ok, ms));

class KoppelFout extends Error {
  constructor(tekst) { super(tekst); this.koppelen = true; }
}
const netwerkFout = (tekst = "geen verbinding") => Object.assign(new Error(tekst), { netwerk: true });
const isNetwerk = (e) => e instanceof TypeError || e?.netwerk === true;

// ---- koppeling (gebruikersnaam + sleutel, alleen op deze telefoon bewaard) ----

function config() {
  try {
    const c = JSON.parse(localStorage.getItem(SLEUTEL));
    return c?.gebruiker && c?.token ? c : null;
  } catch { return null; }
}

export async function koppeling() {
  const c = config();
  return { gebruiker: c?.gebruiker || null, repo: REPO, wachtrij: wachtrij.length, offline: isOffline };
}

export async function koppel(gebruiker, token) {
  gebruiker = gebruiker.trim(); token = token.trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(gebruiker)) throw new Error("Vul je GitHub-gebruikersnaam in.");
  if (!/^[A-Za-z0-9_]{20,300}$/.test(token)) throw new Error("Dit lijkt geen sleutel. Plak de hele tekst die met github_pat_ begint.");
  let r;
  try {
    r = await fetch(`${API}/repos/${gebruiker}/${REPO}`, { headers: koppen(token), cache: "no-store" });
  } catch { throw new Error("Geen verbinding met GitHub. Controleer je internet."); }
  if (r.status === 401) throw new Error("GitHub kent deze sleutel niet. Kopieer hem nog eens.");
  if (r.status === 404 || r.status === 403) throw new Error(`De sleutel heeft geen toegang tot '${REPO}' van ${gebruiker}. Kies bij het maken van de sleutel die repository.`);
  if (!r.ok) throw new Error(`GitHub gaf een fout (${r.status}).`);
  if (!(await r.json()).private) throw new Error(`'${REPO}' is openbaar. Zet hem eerst op privé.`);
  if (config()?.gebruiker !== gebruiker) await wis();
  localStorage.setItem(SLEUTEL, JSON.stringify({ gebruiker, token }));
}

export async function ontkoppel() {
  localStorage.removeItem(SLEUTEL);
  await wis();
}

async function wis() {
  stand = basis = cache = gemeld = null;
  wachtrij.length = 0;
  await bewaar("stand", null);
  toonStatus();
}

// ---- GitHub ----

const koppen = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" });

async function gh(pad, opties = {}) {
  const c = config();
  if (!c) throw new KoppelFout("Nog niet gekoppeld.");
  // no-cache: de browser vraagt elke keer na of het nog klopt (een "niet gewijzigd"-antwoord
  // telt niet mee voor de limiet van GitHub).
  const r = await fetch(`${API}/repos/${c.gebruiker}/${REPO}${pad}`,
    { cache: "no-cache", ...opties, headers: { ...koppen(c.token), ...(opties.headers || {}) } });
  if (r.status === 401) throw new KoppelFout("De sleutel is ongeldig of ingetrokken. Koppel opnieuw.");
  if (r.status >= 500) throw netwerkFout(`GitHub is even niet bereikbaar (${r.status})`);
  return r;
}

async function foutTekst(r) {
  const body = await r.json().catch(() => ({}));
  return `GitHub weigerde dit (${r.status}${body.message ? `: ${body.message}` : ""})`;
}

async function kopCommit() {
  const r = await gh(`/git/ref/heads/${TAK}`);
  if (r.status === 404 || r.status === 409) throw new KoppelFout(`Repository '${REPO}' niet gevonden, leeg, of de sleutel heeft er geen toegang toe.`);
  if (!r.ok) throw new Error(await foutTekst(r));
  return (await r.json()).object.sha;
}

function uitBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function naarBase64(tekst) {
  const bytes = new TextEncoder().encode(tekst);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function haalBoom(commit) {
  const r = await gh(`/git/trees/${commit}?recursive=1`);
  if (!r.ok) throw new Error(await foutTekst(r));
  const oud = stand?.bestanden || {};
  const opSha = Object.fromEntries(Object.values(oud).map((b) => [b.sha, b]));
  const bestanden = {}, nodig = [];
  for (const x of (await r.json()).tree) {
    if (x.type !== "blob" || !DATAPAD.test(x.path)) continue;
    if (opSha[x.sha]) bestanden[x.path] = opSha[x.sha];
    else nodig.push(x);
  }
  // Een paar tegelijk ophalen (eerste keer: alle recepten).
  const lus = async () => {
    for (let x; (x = nodig.pop());) {
      const b = await gh(`/git/blobs/${x.sha}`);
      if (!b.ok) throw new Error(await foutTekst(b));
      bestanden[x.path] = { sha: x.sha, tekst: uitBase64((await b.json()).content) };
    }
  };
  await Promise.all(Array.from({ length: 6 }, lus));
  const gesorteerd = Object.keys(bestanden).sort().map((p) => [p, bestanden[p]]);
  return { commit, bestanden: Object.fromEntries(gesorteerd) };
}

// ---- bewaren in de telefoon (IndexedDB) ----

let dbBelofte = null;
function db() {
  return dbBelofte ||= new Promise((ok, nee) => {
    const r = indexedDB.open("mealplanning", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => nee(r.error);
  });
}
async function kv(modus, fn) {
  const d = await db();
  return new Promise((ok, nee) => {
    const t = d.transaction("kv", modus);
    const req = fn(t.objectStore("kv"));
    t.oncomplete = () => ok(req.result);
    t.onerror = () => nee(t.error);
  });
}
const lees = (k) => kv("readonly", (s) => s.get(k)).catch(() => undefined);
const bewaar = (k, v) => kv("readwrite", (s) => (v == null ? s.delete(k) : s.put(v, k))).catch(() => {});

// ---- inlezen ----

let stand = null;   // {commit, bestanden: {pad: {sha, tekst}}}: wat er op GitHub staat
let basis = null;   // data zoals laad_alles() in tools/mealdata.py, gebouwd uit stand
let cache = null;   // basis + wijzigingen die nog op verbinding wachten
let gemeld = null;  // laatste versie die dataVersie doorgaf
let isOffline = false;
const wachtrij = []; // [{naam, aanpassing}]

function bouw(st) {
  const data = { ingredienten: {}, eenheden: {}, categorieen: [], bewaren: {}, recepten: {}, versies: {}, problemen: [] };
  for (const [pad, { sha, tekst }] of Object.entries(st.bestanden)) {
    const rec = pad.match(/^data\/recepten\/([^/]+)\/([^/]+)\.json$/);
    const naam = pad.match(/^data\/([^/]+)\.json$/)?.[1];
    let doc;
    try {
      doc = JSON.parse(tekst);
    } catch (e) {
      data.problemen.push(`${pad.slice(5)}: ${e.message}`);
      if (PLAN[naam]) { data[naam] = PLAN[naam](); data.versies[naam] = "kapot"; }
      continue;
    }
    if (rec) {
      const [, categorie, id] = rec;
      if (data.recepten[id]) { data.problemen.push(`${pad.slice(5)}: recept-id '${id}' bestaat al`); continue; }
      data.recepten[id] = Object.assign(doc, { id, categorie, _versie: sha });
    } else if (PLAN[naam]) {
      data[naam] = { ...PLAN[naam](), ...doc };
      data.versies[naam] = sha;
    } else if (VAST.includes(naam)) {
      data[naam] = doc;
      data.versies[naam] = sha;
    }
  }
  for (const naam of Object.keys(PLAN)) {
    if (!(naam in data)) { data[naam] = PLAN[naam](); data.versies[naam] = ""; }
  }
  // Aanbiedingen haalt de laptop op (knop); hier alleen lezen. Geen bestand = geen aanbiedingen.
  if (!Array.isArray(data.aanbiedingen?.aanbiedingen)) data.aanbiedingen = { aanbiedingen: [] };
  return data;
}

function zetOffline(aan) {
  if (isOffline !== aan) { isOffline = aan; toonStatus(); }
}

// Bijwerken vanaf GitHub. Zonder bereik: de laatst opgehaalde stand.
async function ververs(opnieuw) {
  if (!config()) throw new KoppelFout("Nog niet gekoppeld.");
  if (!stand) stand = (await lees("stand")) || null;
  if (opnieuw || !basis) {
    try {
      const commit = await kopCommit();
      if (!stand || stand.commit !== commit) {
        stand = await haalBoom(commit);
        basis = null;
        bewaar("stand", stand);
      }
      zetOffline(false);
    } catch (e) {
      if (!isNetwerk(e) || !stand) throw e;
      zetOffline(true);
    }
  }
  basis ||= bouw(stand);
  return basis;
}

function pasToe(data, { naam, aanpassing }) {
  const doc = structuredClone(data[naam]);
  aanpassing(doc, data);
  data[naam] = doc;
}

function bouwCache() {
  cache = basis;
  if (wachtrij.length) {
    cache = structuredClone(basis);
    for (const w of wachtrij) pasToe(cache, w);
  }
  return cache;
}

export async function laad(opnieuw = false) {
  if (cache && !opnieuw) return cache;
  await ververs(true);
  return bouwCache();
}

// Verandert alleen als er van buitenaf iets veranderd is (laptop, Claude, ander apparaat):
// eigen wijzigingen tellen niet, die staan al op het scherm.
export async function dataVersie() {
  if (wachtrij.length) leegWachtrij();
  const commit = await kopCommit();
  if (stand && commit === stand.commit) return (gemeld ??= commit);
  return (gemeld = commit);
}

// ---- opslaan ----

let rij = Promise.resolve();

export function wijzig(naam, aanpassing) {
  const klus = rij.then(() => verstuur(naam, aanpassing));
  rij = klus.catch(() => {});
  return klus;
}

async function verstuur(naam, aanpassing) {
  if (!wachtrij.length) {
    try {
      return await stuur(naam, aanpassing);
    } catch (e) {
      if (!isNetwerk(e) || !basis) throw e;
    }
  }
  // Geen bereik: onthouden en alvast tonen. Wordt verstuurd zodra er weer verbinding is.
  wachtrij.push({ naam, aanpassing });
  eigen();
  zetOffline(true);
  toonStatus();
  return bouwCache();
}

async function stuur(naam, aanpassing) {
  const pad = `data/${naam}.json`;
  for (let poging = 0; poging < 4; poging++) {
    if (poging) await slaap(700 * poging); // GitHub heeft soms een tel nodig voor de nieuwste versie
    const data = await ververs(poging > 0);
    if (data.versies[naam] === "kapot") throw new Error(`${naam}.json is beschadigd. Laat Claude het repareren.`);
    const doc = structuredClone(data[naam]);
    aanpassing(doc, data);
    // Zelfde opmaak als schrijf_json in tools/mealdata.py.
    const tekst = JSON.stringify(doc, null, 2) + "\n";
    const r = await gh(`/contents/${pad}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Telefoon: ${naam} bijgewerkt`, content: naarBase64(tekst), branch: TAK,
        author: AUTEUR, committer: AUTEUR, ...(data.versies[naam] ? { sha: data.versies[naam] } : {}),
      }),
    });
    if (r.ok) {
      const body = await r.json();
      stand.bestanden[pad] = { sha: body.content.sha, tekst };
      // Was onze commit de enige nieuwe? Dan zijn we helemaal bij (anders haalt de volgende
      // ronde de rest op).
      if (body.commit?.parents?.[0]?.sha === stand.commit) stand.commit = body.commit.sha;
      bewaar("stand", stand);
      data[naam] = doc;
      data.versies[naam] = body.content.sha;
      eigen();
      return bouwCache();
    }
    if (r.status !== 409 && r.status !== 422) throw new Error(await foutTekst(r));
  }
  throw new Error("Opslaan mislukt, het bestand werd steeds tegelijk gewijzigd. Probeer het opnieuw.");
}

let legen = false;
function leegWachtrij() {
  if (legen || !wachtrij.length) return;
  legen = true;
  rij = rij.then(async () => {
    try {
      while (wachtrij.length) {
        await stuur(wachtrij[0].naam, wachtrij[0].aanpassing);
        wachtrij.shift();
      }
      zetOffline(false);
      bouwCache();
      window.dispatchEvent(new Event("tekenen"));
    } catch (e) {
      if (!isNetwerk(e)) {
        // Kan niet meer (bv. sleutel ingetrokken): niet eindeloos blijven proberen.
        const n = wachtrij.length;
        wachtrij.length = 0;
        bouwCache();
        window.dispatchEvent(new Event("tekenen"));
        alert(`${n} wijziging${n === 1 ? "" : "en"} kon${n === 1 ? "" : "den"} niet worden opgeslagen: ${e.message}`);
      }
    } finally {
      legen = false;
      toonStatus();
    }
  });
}
window.addEventListener("online", leegWachtrij);

export function bewaarIngredient(slug, ingredient) {
  return wijzig("ingredienten", (doc) => { doc[slug] = ingredient; });
}

export async function bewaarRecept() {
  throw new Error("Recepten bewerken kan alleen op de laptop.");
}

export async function verwijderRecept() {
  throw new Error("Recepten verwijderen kan alleen op de laptop.");
}

export async function taak() {
  throw new Error("Prijzen en aanbiedingen ophalen kan alleen op de laptop.");
}

// ---- melding bovenaan: geen bereik / wijzigingen wachten ----

function toonStatus() {
  const el = document.getElementById("verbinding");
  if (!el) return;
  const n = wachtrij.length;
  el.textContent = n ? `Geen bereik: ${n} wijziging${n === 1 ? "" : "en"} wacht${n === 1 ? "" : "en"} op verbinding. Sluit de app nog niet.`
    : isOffline ? "Geen bereik: je ziet de laatst opgehaalde gegevens." : "";
  el.hidden = !el.textContent;
}
