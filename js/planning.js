// Rekenwerk voor menu, voorraad, boodschappen en suggesties.
// Hoeveelheden zijn steeds {hoeveelheid, eenheid}, zoals in de recepten.
//
// De voorraad bestaat uit partijen: wat je op één dag gekocht hebt, of een aangebroken
// verpakking. {id, ingredient, plek, hoeveelheid?, eenheid?, gekocht?, geopend?, tht?}.
// Zonder hoeveelheid betekent "in huis, genoeg" (zout, kruiden…).

import { afgeleideTags, gram, regels, rekenIng, voeding } from "./voeding.js";
import { breuk, dagenTot, hoeveelheid, nieuwId, nl, plusDagen, vandaag } from "./util.js";

export const PLEKKEN = [["koelkast", "Koelkast"], ["vriezer", "Vriezer"], ["kast", "Voorraadkast"]];
const GAUW = 3; // dagen: "gauw opmaken"

// Eenheden die je in de voorraad bijhoudt: gewicht, volume, stuks en verpakkingen (pak, blok…).
// Bij el/tl/snufje koop je een pot of fles, dan is een hoeveelheid niet zinvol.
export function voorraadEenheden(eenheden) {
  return ["g", "kg", "ml", "l", "stuk", ...Object.keys(eenheden).filter((e) => eenheden[e].verpakking)];
}
const telbaar = (e, eenheden) => e === "stuk" || !!eenheden[e]?.verpakking;

// Uien, citroenen, knoflook, aardappelen ("per_stuk" bij het ingrediënt): je koopt een zak,
// net of bol, maar pakt er losse stuks uit. Zo'n zak gaat niet "open": wat overblijft blijft
// heel, op dezelfde plek en even lang goed. Alleen een half gebruikte ui wordt een open partij.
export const perStuk = (ing) => !!ing?.per_stuk;

// Een dichte zak/net/bol van zo'n ingrediënt omzetten in losse stuks (in gram als het gewicht
// per stuk niet bekend is): 1 net uien (1 kg) → 10 stuks, 1 zak aardappelen → 1500g.
// Past p aan.
function uitpakken(p, ing, eenheden) {
  if (!perStuk(ing) || p.geopend || p.hoeveelheid == null || !eenheden[p.eenheid]?.verpakking) return;
  const doel = ing.gram_per?.stuk ? "stuk" : "g";
  const v = omrekenen(p, doel, ing, eenheden);
  if (v == null) return;
  p.hoeveelheid = rond(v, doel, eenheden);
  p.eenheid = doel;
}

// Kun je er één van aansnijden (een citroen, een ui)? Dan krijgt de partij een knop daarvoor
// in plaats van "Open".
export const aansnijdbaar = (p, ing, eenheden) => perStuk(ing) && !!ing.gram_per?.stuk
  && (p.eenheid === "stuk" || !!eenheden[p.eenheid]?.verpakking);

// Bewaaradvies voor een ingrediënt: groepsadvies uit data/bewaren.json, aangevuld met
// wat er bij het ingrediënt zelf staat. {plek, dagen, open, open_plek}
export function bewaren(ing, data) {
  return { ...data.bewaren.standaard, ...(data.bewaren.groepen[ing.groep] || {}), ...(ing.bewaren || {}) };
}
export const standaardPlek = (ing, data) => bewaren(ing, data).plek;

// Varianten (merken) van hetzelfde product horen bij een algemene soort: "Tofu (Jumbo)" en
// "Tofu (Singh Tahoe)" zijn allebei "tofu". Voorraad en boodschappen kijken naar de soort.
export const soortVan = (data, slug) => data.ingredienten[slug]?.soort || slug;
// Het ingrediënt om mee te rekenen (een soort neemt waarden over van zijn standaardvariant).
export const ingVan = (data, slug) => rekenIng(data.ingredienten, slug);

// Uiterlijk op te maken op (datum), of null als dat niet te zeggen is. Een ingevulde
// tht gaat voor, maar na openen telt de (meestal kortere) houdbaarheid na openen.
export function opTegen(p, data) {
  const ing = ingVan(data, p.ingredient);
  if (!ing) return p.tht || null;
  const b = bewaren(ing, data);
  const vanaf = p.geopend || p.gekocht;
  let d = null;
  if (vanaf) {
    const dagen = p.plek === "vriezer" && b.plek !== "vriezer" ? data.bewaren.vriezer_dagen
      : p.geopend ? b.open : b.dagen;
    d = plusDagen(vanaf, dagen);
  }
  if (p.tht && (!d || p.tht < d)) d = p.tht;
  return d;
}

// Alle partijen van dezelfde soort (dus ook andere merken).
export function partijenVan(data, slug) {
  const s = soortVan(data, slug);
  return data.voorraad.ingredienten.filter((p) => soortVan(data, p.ingredient) === s);
}

const sleutelIng = (slug) => `ing:${slug}`;
export const sleutelExtra = (id) => `extra:${id}`;

// Bewaarde porties uitgedrukt in "keer het recept": 2 porties van een recept voor 4 = 0,5 keer;
// bij basisrecepten (crispy tofu, hoemoes) is één bewaarde portie één keer gemaakt.
const keerVan = (data, p) => {
  const r = data.recepten[p.recept];
  return r?.porties ? p.aantal / r.porties : p.aantal;
};

// Wat er aan zelfgemaakte onderdelen klaarstaat: {beschikbaar: Map(recept → keer), gebruikt: []}.
// Geef dit mee aan bladRegels/benodigd, dan worden die onderdelen eerst gebruikt.
export function bewaardeOnderdelen(data) {
  const beschikbaar = new Map();
  for (const p of data.voorraad.porties) beschikbaar.set(p.recept, (beschikbaar.get(p.recept) || 0) + keerVan(data, p));
  return { beschikbaar, gebruikt: [] };
}

// Alle ingrediëntregels van een recept, met deelrecepten (crispy tofu, hoemoes…) uitgevouwen.
// Levert [regel, factor]: de hoeveelheid in de regel × factor is wat er nodig is.
// Zelfde omrekening van deelrecepten als voeding() in voeding.js.
// Met `onderdelen` (zie bewaardeOnderdelen) wordt een deelrecept dat al gemaakt in de
// koelkast/vriezer staat daaruit genomen in plaats van opnieuw gekookt.
export function* bladRegels(recept, data, keuze, factor = 1, stapel = [], onderdelen = null) {
  for (const regel of regels(recept, keuze)) {
    if (!regel.recept) {
      yield [regel, factor];
      continue;
    }
    const sub = data.recepten[regel.recept];
    if (!sub || stapel.includes(sub.id)) continue;
    let f = regel.hoeveelheid ?? 1;
    if (regel.eenheid === "portie") f /= sub.porties || 1;
    else if (regel.eenheid != null && regel.eenheid !== "keer") {
      const g = gram(regel, {}, data.eenheden);
      const totaal = sub.opbrengst_g || voeding(sub, data, regel.keuze).gram;
      if (g == null || !totaal) continue;
      f = g / totaal;
    }
    let keer = factor * f;
    const klaar = onderdelen?.beschikbaar.get(sub.id) || 0;
    if (klaar > 1e-9) {
      const neem = Math.min(klaar, keer);
      onderdelen.beschikbaar.set(sub.id, klaar - neem);
      onderdelen.gebruikt.push({ recept: sub.id, keer: neem, voor: recept.titel });
      keer -= neem;
    }
    if (keer > 1e-9) yield* bladRegels(sub, data, regel.keuze, keer, [...stapel, recept.id], onderdelen);
  }
}

// Factor t.o.v. het recept: 6 porties van een recept voor 3 = 2. Bij basisrecepten
// (porties null) is `porties` het aantal keer.
export const factorVoor = (recept, porties) => (porties ?? recept.porties ?? 1) / (recept.porties || 1);

function basisVan(e, eenheden) {
  if (e === "stuk") return ["stuk", 1];
  const eh = eenheden[e] || {};
  if (eh.gram != null) return ["g", eh.gram];
  if (eh.ml != null) return ["ml", eh.ml];
  return [null, null];
}

// Hoeveelheid q omrekenen naar eenheid `naar` (voor ingrediënt ing), of null als dat niet kan.
// Stuks en verpakkingen gaan via het gewicht per stuk/verpakking van het ingrediënt.
export function omrekenen(q, naar, ing, eenheden) {
  if (q.eenheid === naar) return q.hoeveelheid;
  const [fa, ka] = basisVan(q.eenheid, eenheden);
  const [fb, kb] = basisVan(naar, eenheden);
  if (fa && fa === fb && fa !== "stuk") return (q.hoeveelheid * ka) / kb;
  const g = gram(q, ing, eenheden);
  const per = gram({ hoeveelheid: 1, eenheid: naar }, ing, eenheden);
  return g != null && per ? g / per : null;
}

// Telt q op bij een lijst hoeveelheden (meestal één). Andere eenheden worden omgerekend
// (el + tl → ml, stuk + g → g als het gewicht per stuk bekend is); lukt dat niet, dan
// komt er een aparte hoeveelheid bij ("2 stuks + 100g").
function optellen(lijst, q, ing, eenheden) {
  for (const x of lijst) {
    if (x.eenheid === q.eenheid) {
      x.hoeveelheid += q.hoeveelheid;
      return;
    }
    for (const doel of [basisVan(x.eenheid, eenheden)[0], "g"]) {
      if (!doel) continue;
      const a = omrekenen(x, doel, ing, eenheden);
      const b = omrekenen(q, doel, ing, eenheden);
      if (a != null && b != null) {
        x.eenheid = doel;
        x.hoeveelheid = a + b;
        return;
      }
    }
  }
  lijst.push({ ...q });
}

// Wat er per soort nodig is voor een lijst gerechten [{recept, porties, keuze, dag?}].
// Map soort → {slug, ing, nodig: [hoeveelheden], zonderHoeveelheid, recepten: Set van titels,
// dag: vroegste dag waarop het nodig is (zonder dag: vandaag)}.
// Varianten van dezelfde soort tellen samen ("Tofu", niet "Tofu (Jumbo)").
// Regels zonder databasekoppeling ("Pastawater") tellen niet mee.
// Met `onderdelen` worden bewaarde deelrecepten eerst gebruikt; wat daaruit kwam staat
// daarna in onderdelen.gebruikt.
export function benodigd(gerechten, data, onderdelen = null) {
  const m = new Map();
  const nu = vandaag();
  for (const g of gerechten) {
    const r = data.recepten[g.recept];
    if (!r) continue;
    const dag = g.dag && g.dag > nu ? g.dag : nu;
    for (const [regel, f] of bladRegels(r, data, g.keuze, factorVoor(r, g.porties), [], onderdelen)) {
      if (!data.ingredienten[regel.ingredient]) continue;
      const slug = soortVan(data, regel.ingredient);
      const ing = ingVan(data, slug);
      let x = m.get(slug);
      if (!x) m.set(slug, (x = { slug, ing, nodig: [], zonderHoeveelheid: false, recepten: new Set(), dag }));
      if (dag < x.dag) x.dag = dag;
      x.recepten.add(r.titel);
      if (regel.hoeveelheid == null) x.zonderHoeveelheid = true;
      else optellen(x.nodig, { hoeveelheid: regel.hoeveelheid * f, eenheid: regel.eenheid }, ing, data.eenheden);
    }
  }
  return m;
}

// Vergelijkt wat nodig is met de partijen in voorraad. Geeft {status, rest}:
//   "kopen"   rest = wat je nog moet halen (kan minder zijn dan nodig)
//   "genoeg"  in huis; een partij zonder hoeveelheid geldt altijd als genoeg
//   "onzeker" wel in huis, maar niet te vergelijken (bv. 'stuks' zonder gewicht per stuk)
export function vergelijk(nodig, partijen, data) {
  if (!partijen.length) return { status: "kopen", rest: nodig };
  if (partijen.some((p) => p.hoeveelheid == null)) return { status: "genoeg", rest: [] };
  const rest = nodig.map((q) => ({ ...q }));
  let vergeleken = false;
  for (const p of partijen) {
    const ing = ingVan(data, p.ingredient); // elke partij rekent met zijn eigen merk (blok van 500 g…)
    let over = p.hoeveelheid;
    for (const x of rest) {
      if (over <= 1e-9) break;
      if (x.hoeveelheid <= 1e-9) continue;
      const v = omrekenen({ hoeveelheid: over, eenheid: p.eenheid }, x.eenheid, ing, data.eenheden);
      if (v == null || v <= 0) continue;
      vergeleken = true;
      const gebruikt = Math.min(v, x.hoeveelheid);
      x.hoeveelheid -= gebruikt;
      over *= 1 - gebruikt / v;
    }
  }
  if (rest.length && !vergeleken) return { status: "onzeker", rest: [] };
  const kopen = rest.filter((x) => x.hoeveelheid > 1e-6);
  return kopen.length ? { status: "kopen", rest: kopen } : { status: "genoeg", rest: [] };
}

// De verpakking waarin je een ingrediënt koopt: [eenheid, gram], bv. ["blok", 500], of null.
export function verpakkingVan(ing, eenheden) {
  const e = Object.keys(ing.gram_per || {}).find((k) => eenheden[k]?.verpakking);
  return e ? [e, ing.gram_per[e]] : null;
}

// Wat er nodig is uitgedrukt in hele verpakkingen ({hoeveelheid: 2, eenheid: "blok"}), of null.
export function inVerpakkingen(lijst, ing, eenheden) {
  const v = verpakkingVan(ing, eenheden);
  if (!v || !lijst.length) return null;
  let g = 0;
  for (const q of lijst) {
    const x = gram(q, ing, eenheden);
    if (x == null) return null;
    g += x;
  }
  return { hoeveelheid: Math.max(1, Math.ceil(g / v[1] - 0.02)), eenheid: v[0] };
}

// Gerechten op het menu die gekookt moeten worden (niet: "uit de voorraad" opeten).
export const teKoken = (data) => data.menu.gerechten.filter((g) => g.uit !== "voorraad" && data.recepten[g.recept]);

// ---- Wat "in huis" is zonder hoeveelheid (olie, sauzen, kruiden) raakt ook op ----
// Geschat uit het logboek: alles wat sinds het kopen gekookt is, in gram. Niets hiervan wordt
// opgeslagen; haal je een kookbeurt uit het logboek, dan klopt de schatting vanzelf weer.
const SNUFJE = 1; // gram voor een regel zonder hoeveelheid ("zout", "peper") of zonder gewicht
export const BIJNA_OP = 0.8; // vanaf dit deel van een verpakking: op de boodschappenlijst
export const OP_DAGEN = 14; // zo lang staat iets dat je als "op" markeerde op de boodschappenlijst

// Gram per soort uit alle kookbeurten: Map soort → [[datum, gram]].
const verbruikCache = new WeakMap();
function gekooktVerbruik(data) {
  const lijst = data.logboek.gekookt;
  let m = verbruikCache.get(lijst);
  if (m) return m;
  m = new Map();
  for (const k of lijst) {
    const r = data.recepten[k.recept];
    if (!r) continue;
    for (const [regel, f] of bladRegels(r, data, k.keuze, factorVoor(r, k.porties))) {
      if (!data.ingredienten[regel.ingredient]) continue;
      const s = soortVan(data, regel.ingredient);
      const g = regel.hoeveelheid == null ? null
        : gram({ hoeveelheid: regel.hoeveelheid * f, eenheid: regel.eenheid }, ingVan(data, regel.ingredient), data.eenheden);
      if (!m.has(s)) m.set(s, []);
      m.get(s).push([k.datum, g ?? SNUFJE]);
    }
  }
  verbruikCache.set(lijst, m);
  return m;
}

// Gram in een gewone verpakking: die van het ingrediënt (fles van 500 ml…), anders de
// vuistregel voor de groep (bewaren.json, "inhoud").
export const inhoud = (ing, data) => verpakkingVan(ing, data.eenheden)?.[1] || bewaren(ing, data).inhoud || null;

// Welk deel van een partij "in huis" (zonder hoeveelheid) naar schatting al gebruikt is
// (0 = vol, 1 = op), of null als dat niet te zeggen is. Telt vanaf het kopen, of vanaf
// `geteld` (gezet bij "nog genoeg").
export function geschatGebruikt(p, data) {
  if (p.hoeveelheid != null) return null;
  const ing = ingVan(data, p.ingredient);
  const vol = ing && inhoud(ing, data);
  if (!vol) return null;
  const vanaf = p.geteld || p.gekocht || "";
  const g = (gekooktVerbruik(data).get(soortVan(data, p.ingredient)) || [])
    .reduce((s, [datum, x]) => (datum >= vanaf ? s + x : s), 0);
  return g / vol;
}

// Is deze soort (alle partijen "in huis") naar schatting bijna op? Geeft het geschatte deel, of null.
export function bijnaOp(partijen, data) {
  if (!partijen.length || partijen.some((p) => p.hoeveelheid != null)) return null;
  const f = partijen.map((p) => geschatGebruikt(p, data));
  if (f.some((x) => x == null)) return null;
  const min = Math.min(...f);
  return min >= BIJNA_OP ? min : null;
}

// Vaste voorraad ("altijd minstens 2 pakken kikkererwten in huis"), per soort:
// {soort: {hoeveelheid, eenheid}} uit instellingen.json.
export const minimumVan = (data, slug) => (data.instellingen.minimum || {})[soortVan(data, slug)] || null;

// De boodschappenlijst: één item per ingrediënt, voor alles op het menu, plus de vaste
// voorraad aanvullen, plus wat "in huis" is maar naar schatting bijna op (`bijnaOp`).
// Zelfgemaakte onderdelen die al klaarstaan (crispy tofu in de koelkast) gaan eerst; die
// staan in lijst.onderdelen. Verse dingen die pas later in de week nodig zijn krijgen `later`:
// de dag vanaf wanneer je ze kunt kopen zonder dat ze bederven.
export function boodschappenlijst(data) {
  const onderdelen = bewaardeOnderdelen(data);
  const items = [];
  const m = benodigd(teKoken(data), data, onderdelen);
  const leeg = (s) => ({ slug: s, ing: ingVan(data, s), nodig: [], zonderHoeveelheid: false, recepten: new Set(), dag: vandaag() });
  // Vaste voorraad komt bovenop wat het menu nodig heeft.
  for (const [slug, q] of Object.entries(data.instellingen.minimum || {})) {
    if (!data.ingredienten[slug]) continue;
    const s = soortVan(data, slug);
    if (!m.has(s)) m.set(s, leeg(s));
    const x = m.get(s);
    x.minimum = q;
    optellen(x.nodig, { ...q }, x.ing, data.eenheden);
  }
  // Wat zonder hoeveelheid in huis is, ook als het niet op het menu staat (misschien bijna op).
  for (const p of data.voorraad.ingredienten) {
    const s = soortVan(data, p.ingredient);
    if (p.hoeveelheid == null && data.ingredienten[p.ingredient] && !m.has(s)) m.set(s, leeg(s));
  }
  // Wat je de laatste twee weken als "op" hebt gemarkeerd en nog niet opnieuw in huis is.
  const grens = plusDagen(vandaag(), -(OP_DAGEN - 1));
  for (const o of data.logboek.opgemaakt || []) {
    if (o.datum < grens || o.niet_kopen || !data.ingredienten[o.ingredient]) continue;
    const s = soortVan(data, o.ingredient);
    if (partijenVan(data, s).length) continue;
    if (!m.has(s)) m.set(s, leeg(s));
    m.get(s).opgemaakt = o.datum;
  }
  for (const x of m.values()) {
    const partijen = partijenVan(data, x.slug);
    let v = vergelijk(x.nodig, partijen, data);
    const op = bijnaOp(partijen, data);
    if (op != null) v = { status: "kopen", rest: [], bijnaOp: op };
    // Niet voor het menu en niets te kopen: hoort niet op deze lijst.
    if (!x.recepten.size && v.status !== "kopen") continue;
    const houdbaar = bewaren(x.ing, data).dagen;
    const later = v.status === "kopen" && !x.minimum && op == null && dagenTot(x.dag) > houdbaar
      ? plusDagen(x.dag, -houdbaar) : null;
    items.push({ ...x, ...v, partijen, later, sleutel: sleutelIng(x.slug) });
  }
  items.onderdelen = onderdelen.gebruikt;
  return items;
}

// Geschatte prijs van wat je koopt (lijst hoeveelheden of verpakkingen), of null zonder prijs.
export function prijsVan(lijst, ing, eenheden) {
  if (ing?.prijs_per_kg == null || !lijst.length) return null;
  let g = 0;
  for (const q of lijst) {
    const x = gram(q, ing, eenheden);
    if (x == null) return null;
    g += x;
  }
  return (g / 1000) * ing.prijs_per_kg;
}

// Afronden zoals je het opschrijft: grammen hele getallen, stuks en verpakkingen op kwarten.
export function rond(v, eenheid, eenheden = {}) {
  if (eenheid === "stuk" || eenheden[eenheid]?.verpakking) return Math.round(v * 4) / 4;
  if (eenheid === "g" || eenheid === "ml") return Math.round(v);
  return Math.round(v * 100) / 100;
}

// "240g", "1,5kg", "2 stuks", "3 blokken", "1½ el"; meerdere hoeveelheden met " + ".
// Met `ing` krijgen stuks de naam van het ingrediënt als die er is ("4 teentjes" knoflook).
export function toonHoeveelheid(lijst, eenheden = {}, ing = null) {
  return lijst.map((q) => {
    const v = q.hoeveelheid;
    if ((q.eenheid === "g" || q.eenheid === "ml") && v >= 1000) return `${nl(v / 1000, 2)}${q.eenheid === "g" ? "kg" : "l"}`;
    if (q.eenheid === "stuk" && ing?.stuknaam) return `${breuk(v)} ${ing.stuknaam[v > 1 ? 1 : 0]}`;
    if (q.eenheid === "stuk" || eenheden[q.eenheid]?.verpakking) {
      return `${breuk(v)} ${v > 1 ? eenheden[q.eenheid]?.meervoud || q.eenheid : q.eenheid}`;
    }
    return hoeveelheid(q);
  }).join(" + ");
}

// Eén partij als tekst: "3 blokken (1,5kg)", "1 net (±10 stuks)", "200g open", "in huis".
export function toonPartij(p, data) {
  if (p.hoeveelheid == null) return "in huis";
  const { eenheden } = data;
  const ing = ingVan(data, p.ingredient);
  let t = toonHoeveelheid([p], eenheden, ing);
  if (eenheden[p.eenheid]?.verpakking && ing) {
    const stuks = perStuk(ing) && ing.gram_per?.stuk ? omrekenen(p, "stuk", ing, eenheden) : null;
    const g = gram(p, ing, eenheden);
    if (stuks != null) t += ` (±${toonHoeveelheid([{ hoeveelheid: Math.round(stuks), eenheid: "stuk" }], eenheden, ing)})`;
    else if (g != null) t += ` (${toonHoeveelheid([{ hoeveelheid: g, eenheid: "g" }])})`;
  }
  return p.geopend ? `${t} open` : t;
}
export const toonPartijen = (lijst, data) =>
  lijst.length ? lijst.map((p) => toonPartij(p, data)).join(" + ") : "op";

// Volgorde van opmaken: eerst wat al open is, dan de oudste dichte partij.
const opmaakVolgorde = (a, b) => (a.geopend ? 0 : 1) - (b.geopend ? 0 : 1)
  || (a.geopend || a.gekocht || "").localeCompare(b.geopend || b.gekocht || "");

// Haalt `nodig` uit de partijen van één ingrediënt, zoals in een echte keuken: eerst wat al
// open is, dan de oudste dichte verpakking. Wordt een verpakking (of een ui, een aubergine)
// maar half gebruikt, dan wordt de rest een open partij, op de plek waar die na openen hoort.
// De partijen mogen van verschillende merken van dezelfde soort zijn; elke partij rekent met
// zijn eigen merk. Een zak uien of een net citroenen gaat niet open: die wordt losse stuks
// (zie uitpakken), en wat in gram over is (aardappelen, wortelen) blijft dicht.
// Geeft {partijen: nieuwe lijst, gelukt: of er iets afgeboekt kon worden}.
export function afboeken(partijen, nodig, data, datum = vandaag()) {
  const { eenheden } = data;
  const lijst = partijen.map((p) => ({ ...p }));
  const volgorde = lijst.filter((p) => p.hoeveelheid != null).sort(opmaakVolgorde);
  let gelukt = false;
  for (const q of nodig) {
    let rest = q.hoeveelheid;
    for (const p of volgorde) {
      if (rest <= 1e-9) break;
      if (!(p.hoeveelheid > 0)) continue;
      const ing = ingVan(data, p.ingredient);
      if (!ing) continue;
      const b = bewaren(ing, data);
      uitpakken(p, ing, eenheden);
      const beschikbaar = omrekenen({ hoeveelheid: p.hoeveelheid, eenheid: p.eenheid }, q.eenheid, ing, eenheden);
      if (beschikbaar == null || beschikbaar <= 0) continue;
      gelukt = true;
      const neem = Math.min(rest, beschikbaar);
      const neemP = (neem / beschikbaar) * p.hoeveelheid; // in de eenheid van de partij
      rest -= neem;
      if (!p.geopend && telbaar(p.eenheid, eenheden)) {
        // Hele verpakkingen/stuks aanbreken; wat overblijft wordt een open partij.
        const heel = Math.ceil(neemP - 1e-6);
        const over = heel - neemP;
        p.hoeveelheid -= heel;
        if (over > 0.02) {
          const doel = basisVan(q.eenheid, eenheden)[0];
          const inBasis = p.eenheid !== "stuk" && (doel === "g" || doel === "ml")
            ? omrekenen({ hoeveelheid: over, eenheid: p.eenheid }, doel, ing, eenheden) : null;
          const open = inBasis != null ? { hoeveelheid: rond(inBasis, doel), eenheid: doel }
            : { hoeveelheid: rond(over, p.eenheid, eenheden), eenheid: p.eenheid };
          if (open.hoeveelheid > 0) {
            lijst.push({ id: nieuwId(), ingredient: p.ingredient, ...open,
              plek: p.plek === "vriezer" && b.open_plek === "vriezer" ? "vriezer" : b.open_plek,
              ...(p.gekocht ? { gekocht: p.gekocht } : {}), geopend: datum, ...(p.tht ? { tht: p.tht } : {}) });
          }
        }
      } else {
        p.hoeveelheid = rond(p.hoeveelheid - neemP, p.eenheid, eenheden);
        if (p.hoeveelheid > 0 && !p.geopend && !perStuk(ing)) {
          p.geopend = datum;
          if (p.plek !== "vriezer") p.plek = b.open_plek;
        }
      }
    }
  }
  return { partijen: lijst.filter((p) => p.hoeveelheid == null || p.hoeveelheid > 0.001), gelukt };
}

// Een verpakking openen (zonder te koken): bij meerdere dichte verpakkingen gaat er één
// open; die wordt waar mogelijk in gram omgerekend en verhuist naar de plek na openen.
// Bij een zak/net per stuk (citroenen) is dat aansnijden: de zak wordt losse stuks en er gaat
// er één open; de rest blijft heel.
export function openen(partijen, id, data, datum = vandaag()) {
  const { eenheden } = data;
  const lijst = partijen.map((p) => ({ ...p }));
  const p = lijst.find((x) => x.id === id);
  if (!p || p.geopend) return lijst;
  const ing = ingVan(data, p.ingredient);
  const b = bewaren(ing, data);
  if (perStuk(ing)) {
    uitpakken(p, ing, eenheden);
    if (p.eenheid !== "stuk") return lijst; // in gram: niets om aan te snijden
  }
  let open = p;
  if (telbaar(p.eenheid, eenheden) && p.hoeveelheid > 1) {
    p.hoeveelheid -= 1;
    open = { ...p, id: nieuwId(), hoeveelheid: 1 };
    lijst.push(open);
  }
  if (eenheden[open.eenheid]?.verpakking && open.hoeveelheid != null) {
    const g = omrekenen(open, "g", ing, eenheden);
    if (g != null) Object.assign(open, { hoeveelheid: rond(g, "g"), eenheid: "g" });
  }
  open.geopend = datum;
  if (open.plek !== "vriezer" || b.open_plek === "vriezer") open.plek = b.open_plek;
  return lijst;
}

// Gekochte boodschappen als nieuwe partij in de voorraad (past `partijen` aan).
// Komt bij een dichte partij van dezelfde dag, plek en eenheid.
export function inVoorraad(partijen, slug, gekocht, data, datum = vandaag()) {
  const { eenheden } = data;
  const ing = ingVan(data, slug);
  const tellen = ing.verwaarloosbaar ? [] : gekocht.filter((q) => voorraadEenheden(eenheden).includes(q.eenheid));
  const q = tellen.length === 1 && tellen.length === gekocht.length ? tellen[0] : null;
  const plek = standaardPlek(ing, data);
  if (!q) {
    // Hoeveelheid onbekend (een potje kruiden e.d.): "in huis", tenzij er al iets ligt.
    // Ligt het er al zonder hoeveelheid, dan is dit een nieuwe verpakking: opnieuw beginnen met tellen.
    const s = soortVan(data, slug);
    const vanSoort = partijen.filter((p) => soortVan(data, p.ingredient) === s);
    if (!vanSoort.length) partijen.push({ id: nieuwId(), ingredient: slug, plek, gekocht: datum });
    for (const p of vanSoort) {
      if (p.hoeveelheid != null) continue;
      p.gekocht = datum;
      delete p.geteld;
      delete p.geopend;
    }
    return;
  }
  const hv = rond(q.hoeveelheid, q.eenheid, eenheden) || 1;
  const zelfde = partijen.find((p) => p.ingredient === slug && !p.geopend && p.gekocht === datum
    && p.plek === plek && p.eenheid === q.eenheid && p.hoeveelheid != null && !p.tht);
  if (zelfde) zelfde.hoeveelheid = rond(zelfde.hoeveelheid + hv, q.eenheid, eenheden);
  else partijen.push({ id: nieuwId(), ingredient: slug, plek, hoeveelheid: hv, eenheid: q.eenheid, gekocht: datum });
}

// Wat een maaltijd uit de voorraad haalt, per ingrediënt dat in huis is:
// {slug, ing, nodig, voor: partijen nu, na: partijen daarna (null = niet te berekenen)}.
// Met `metOnderdelen` worden bewaarde deelrecepten (crispy tofu…) eerst gebruikt; welke
// staat in uit.onderdelen ([{recept, keer, voor}]).
export function verbruik(recept, porties, keuze, data, metOnderdelen = true) {
  const uit = [];
  const onderdelen = metOnderdelen ? bewaardeOnderdelen(data) : null;
  uit.onderdelen = [];
  for (const x of benodigd([{ recept: recept.id, porties, keuze }], data, onderdelen).values()) {
    const voor = partijenVan(data, x.slug);
    if (!voor.length) continue;
    const metHv = voor.filter((p) => p.hoeveelheid != null);
    if (!metHv.length && x.ing.verwaarloosbaar) continue; // zout, kruiden: blijft gewoon in huis
    const af = metHv.length && x.nodig.length ? afboeken(voor, x.nodig, data) : null;
    uit.push({ slug: x.slug, ing: x.ing, nodig: x.nodig, voor, na: af?.gelukt ? af.partijen : null });
  }
  if (onderdelen) uit.onderdelen = onderdelen.gebruikt;
  return uit;
}

// Gebruikte bewaarde onderdelen uit de porties halen (past `porties` uit voorraad.json aan):
// eerst de koelkast, de oudste eerst. `gebruikt` = [{recept, keer}].
export function onderdelenAfnemen(porties, gebruikt, data) {
  for (const { recept, keer } of gebruikt) {
    const r = data.recepten[recept];
    let rest = r?.porties ? keer * r.porties : keer; // in porties van dat recept
    const volgorde = porties.filter((p) => p.recept === recept)
      .sort((a, b) => (a.plek === "koelkast" ? 0 : 1) - (b.plek === "koelkast" ? 0 : 1) || a.sinds.localeCompare(b.sinds));
    for (const p of volgorde) {
      if (rest <= 1e-9) break;
      const neem = Math.min(rest, p.aantal);
      p.aantal = Math.round((p.aantal - neem) * 100) / 100;
      rest -= neem;
    }
  }
  for (let i = porties.length - 1; i >= 0; i--) if (!(porties[i].aantal > 0.01)) porties.splice(i, 1);
}

// Alles in de voorraad dat binnen een paar dagen op moet: [{p, ing, datum, dagen}], vroegste eerst.
export function gauwOp(data, dagen = GAUW) {
  return data.voorraad.ingredienten
    .map((p) => {
      const ing = data.ingredienten[p.ingredient];
      const datum = opTegen(p, data);
      return { p, ing, datum, dagen: datum ? dagenTot(datum) : null };
    })
    .filter((x) => x.datum && x.dagen <= dagen)
    .sort((a, b) => a.datum.localeCompare(b.datum));
}

// Hoe goed past een recept bij de voorraad? Alleen ingrediënten die er echt toe doen
// (met hoeveelheid, geen zout/kruiden). `gauw` = gebruikt iets dat binnen 3 dagen op moet
// (ook aangebroken verpakkingen).
export function dekking(recept, data) {
  let totaal = 0;
  const ontbreekt = [], gauw = [];
  for (const x of benodigd([{ recept: recept.id }], data, bewaardeOnderdelen(data)).values()) {
    if (x.ing.verwaarloosbaar || !x.nodig.length) continue;
    totaal++;
    const partijen = partijenVan(data, x.slug);
    if (vergelijk(x.nodig, partijen, data).status === "kopen") ontbreekt.push(x.ing.naam);
    const eerst = partijen.map((p) => ({ p, datum: opTegen(p, data) })).filter((y) => y.datum)
      .sort((a, b) => a.datum.localeCompare(b.datum))[0];
    if (eerst && dagenTot(eerst.datum) <= GAUW) gauw.push({ naam: x.ing.naam, datum: eerst.datum, open: !!eerst.p.geopend });
  }
  return { totaal, ontbreekt, gauw };
}

// Bewaarde (zelfgekookte) porties. Vuistregel voor hoe lang ze goed blijven; daarna
// krijgen ze een waarschuwing. Pas de getallen gerust aan.
export const BEWAARDAGEN = { koelkast: 3, vriezer: 90 };
export const PORTIE_PLEKKEN = [["koelkast", "Koelkast"], ["vriezer", "Vriezer"]];

// Hoe lang een portie al op zijn huidige plek ligt, en of dat te lang is.
export function portieStatus(p) {
  const dagen = Math.max(0, -dagenTot(p.sinds));
  return { dagen, oud: dagen >= BEWAARDAGEN[p.plek] };
}

// Bewaarde porties, die het eerst op moeten bovenaan: koelkast voor vriezer, oudste eerst.
export function bewaardePorties(data) {
  const rang = (p) => (p.plek === "koelkast" ? 0 : 1);
  return [...data.voorraad.porties].sort((a, b) =>
    rang(a) - rang(b) || a.sinds.localeCompare(b.sinds) || a.gekookt.localeCompare(b.gekookt));
}

// Aantal bewaarde porties per gerecht (varianten bij het basisrecept). {basisId: {koelkast, vriezer}}
export function bewaardPerGerecht(data) {
  const m = {};
  for (const p of data.voorraad.porties) {
    const id = data.recepten[p.recept]?.variant_van || p.recept;
    const x = (m[id] ||= { koelkast: 0, vriezer: 0 });
    x[p.plek] += p.aantal;
  }
  return m;
}

// Maaltijden zonder 'door' zijn van voor de mealprep-functie: die heb je zelf gegeten.
export const zelfGegeten = (m) => m.door !== "ander";

// Laatst zelf gegeten per gerecht. Varianten tellen mee voor het basisrecept.
// Geeft {basisId: {datum, aantal}}.
export function laatstGegeten(data) {
  const m = {};
  for (const e of data.logboek.maaltijden.filter(zelfGegeten)) {
    const id = data.recepten[e.recept]?.variant_van || e.recept;
    const x = (m[id] ||= { datum: e.datum, aantal: 0 });
    x.aantal++;
    if (e.datum > x.datum) x.datum = e.datum;
  }
  return m;
}

// Kenmerken van een gerecht voor afwisseling: categorie (pasta, rijst…), keuken en eiwitbron.
// "Overige gerechten" is een verzamelbak en zegt niets over afwisseling.
export function kenmerken(r, data) {
  const cat = data.categorieen.find((c) => c.id === r.categorie);
  return [...new Set([
    ...(cat && !cat.onderdeel && cat.id !== "overige-gerechten" ? [cat.naam.toLowerCase()] : []),
    ...(r.tags?.keuken || []),
    ...afgeleideTags(r, data).eiwit,
  ])];
}

// Wat er de afgelopen week gegeten is en wat er op het menu staat, geteld per kenmerk:
// Map("italiaans" → 2, "pastagerechten" → 1, "tofu" → 3).
export function dezeWeek(data) {
  const telling = new Map();
  const tel = (rid) => {
    const r = data.recepten[rid];
    if (!r) return;
    for (const k of kenmerken(data.recepten[r.variant_van] || r, data)) telling.set(k, (telling.get(k) || 0) + 1);
  };
  for (const m of data.logboek.maaltijden) if (zelfGegeten(m) && dagenTot(m.datum) >= -6) tel(m.recept);
  for (const g of data.menu.gerechten) tel(g.recept);
  return telling;
}

// Hoe vaak de kenmerken van een gerecht al voorkomen deze week: {score, meest: [kenmerk, aantal]}.
export function overlap(r, data, week) {
  let score = 0, meest = null;
  for (const k of kenmerken(r, data)) {
    const n = week.get(k) || 0;
    score += n;
    if (n && (!meest || n > meest[1])) meest = [k, n];
  }
  return { score, meest };
}

// Wat je zelf at per dag: {datum: {kcal, eiwit, maaltijden: [{recept, porties}]}}.
// Oude logregels (van voor de mealprep-functie, zonder 'door') betekenden "gekookt voor N";
// die tellen als 1 portie voor jezelf.
export function voedingPerDag(data, vanaf, tot = vandaag()) {
  const dagen = {};
  for (let d = vanaf; d <= tot; d = plusDagen(d, 1)) dagen[d] = { kcal: 0, eiwit: 0, maaltijden: [] };
  for (const m of data.logboek.maaltijden) {
    if (!zelfGegeten(m) || !dagen[m.datum]) continue;
    const r = data.recepten[m.recept];
    if (!r) continue;
    const t = voeding(r, data, m.keuze);
    const porties = m.door ? m.porties || 1 : 1;
    const deel = r.porties ? porties / r.porties : porties;
    dagen[m.datum].kcal += t.kcal * deel;
    dagen[m.datum].eiwit += t.eiwit * deel;
    dagen[m.datum].maaltijden.push({ recept: r, porties });
  }
  return dagen;
}

// Getal dat per dag verandert: om suggesties met gelijke score elke dag anders te schudden.
export function dagwaarde(tekst) {
  let h = 2166136261;
  for (const c of tekst + vandaag()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
