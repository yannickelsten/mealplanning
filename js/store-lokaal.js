// Op de laptop: de data komt van de lokale server (server.py). Zie store.js.

export const soort = "lokaal";
export const alleenLezen = false;
export const kijkElke = 3000;
let cache = null;

export async function laad(opnieuw = false) {
  if (!cache || opnieuw) {
    // Eén keer opnieuw proberen: soms breekt een virusscanner een verbinding af.
    const r = await fetch("/api/data").catch(() => fetch("/api/data"));
    const body = await r.json();
    if (!r.ok) throw new Error(body.fout || `Fout ${r.status}`);
    for (const [id, recept] of Object.entries(body.recepten)) recept.id = id;
    cache = body;
  }
  return cache;
}

export async function bewaarIngredient(slug, ingredient) {
  const r = await fetch(`/api/ingredient/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ingredient),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.fout || `Opslaan mislukt (${r.status})`);
  eigen();
  cache = null;
}

// Moment van de laatste eigen wijziging: een wijziging die de app zelf net deed hoeft niet
// als "nieuw van buitenaf" opnieuw ingelezen te worden.
export let laatsteEigenWijziging = 0;
const eigen = () => { laatsteEigenWijziging = Date.now(); };

// Vingerafdruk van data/: verandert zodra er een bestand bijkomt of wijzigt (ook door Claude).
export async function dataVersie() {
  const r = await fetch("/api/versie");
  if (!r.ok) throw new Error(`Fout ${r.status}`);
  return (await r.json()).versie;
}

// Een recept opslaan (nieuw of gewijzigd). recept._versie is de versie die we hadden
// ingelezen; is het bestand intussen gewijzigd (bv. door Claude), dan volgt een fout met
// .conflict = true, tenzij `forceer`. Geeft de nieuwe versie terug.
export async function bewaarRecept(id, categorie, recept, { forceer = false } = {}) {
  const { id: _id, categorie: _cat, _versie, ...schoon } = recept;
  const r = await fetch(`/api/recept/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Versie": _versie || "" },
    body: JSON.stringify({ categorie, recept: schoon, ...(forceer ? { forceer: true } : {}) }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const fout = new Error(body.fout || `Opslaan mislukt (${r.status})`);
    fout.conflict = r.status === 409;
    throw fout;
  }
  eigen();
  cache = null;
  return body.versie;
}

// Recept naar de prullenbak (data/prullenbak), niet echt weg.
export async function verwijderRecept(recept) {
  const r = await fetch(`/api/recept/${encodeURIComponent(recept.id)}`, {
    method: "DELETE", headers: { "X-Versie": recept._versie || "" },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.fout || `Verwijderen mislukt (${r.status})`);
  eigen();
  cache = null;
}

// Wijzig een van de bestanden die de app bijhoudt: logboek, voorraad, menu, boodschappen.
// `aanpassing(doc, data)` past een kopie van het bestand aan. Is het bestand intussen
// ergens anders gewijzigd (ander tabblad, of Claude), dan leest de app het opnieuw in en
// past de aanpassing nog eens toe op de nieuwste versie: er gaat dus niets verloren.
// Wijzigingen worden na elkaar verstuurd. Geeft de bijgewerkte data terug.
let rij = Promise.resolve();

export function wijzig(naam, aanpassing) {
  const klus = rij.then(() => verstuur(naam, aanpassing));
  rij = klus.catch(() => {});
  return klus;
}

async function verstuur(naam, aanpassing) {
  for (let poging = 0; poging < 3; poging++) {
    const data = await laad(poging > 0);
    const doc = structuredClone(data[naam]);
    aanpassing(doc, data);
    const r = await fetch(`/api/${naam}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Versie": data.versies[naam] },
      body: JSON.stringify(doc),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) {
      data[naam] = doc;
      data.versies[naam] = body.versie;
      eigen();
      return data;
    }
    if (r.status !== 409) throw new Error(body.fout || `Opslaan mislukt (${r.status})`);
  }
  throw new Error("Opslaan mislukt, het bestand werd steeds tegelijk gewijzigd. Probeer het opnieuw.");
}

// Een klus op de server starten en volgen: "bijwerken" (Jumboprijzen + aanbiedingen van AH en
// Jumbo). Alleen als je op de knop drukt. `voortgang(status)` krijgt
// tussendoor {voortgang: 0..1, tekst}. Geeft de uitkomst; een fout wordt een Error.
export async function taak(naam, voortgang = () => {}) {
  const vraag = (opties) => fetch(`/api/taak/${naam}`, opties).then(async (r) => {
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.fout || `Fout ${r.status}`);
    return body;
  });
  let st = await vraag({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  while (st.bezig) {
    voortgang(st);
    await new Promise((ok) => setTimeout(ok, 1000));
    st = await vraag().catch(() => st); // even geen antwoord: gewoon nog eens vragen
  }
  if (st.fout) throw new Error(st.fout);
  cache = null;
  return st.uitkomst;
}

// Koppeling met GitHub (voor de telefoon). De server bewaart de sleutel buiten OneDrive en
// geeft hem nooit terug.
export async function koppeling() {
  const r = await fetch("/api/koppeling");
  if (!r.ok) throw new Error(`Fout ${r.status}`);
  return r.json();
}

export async function koppel(gebruiker, token) {
  const r = await fetch("/api/koppeling", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gebruiker, token }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.fout || `Koppelen mislukt (${r.status})`);
}

export async function ontkoppel() {
  const r = await fetch("/api/koppeling", { method: "DELETE" });
  if (!r.ok) throw new Error(`Ontkoppelen mislukt (${r.status})`);
}
