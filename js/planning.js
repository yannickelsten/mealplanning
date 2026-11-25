// Rekenwerk voor menu, voorraad, boodschappen en suggesties.
// Hoeveelheden zijn steeds {hoeveelheid, eenheid}, zoals in de recepten.
//
// De voorraad bestaat uit partijen: wat je op één dag gekocht hebt, of een aangebroken
// verpakking. {id, ingredient, plek, hoeveelheid?, eenheid?, gekocht?, geopend?, tht?}.
// Zonder hoeveelheid betekent "in huis, genoeg" (zout, kruiden…).

import { afgeleideTags, gram, regels, rekenIng, voeding } from "./voeding.js";
import { breuk, dagenTot, datumNl, geleden, hoeveelheid, houdbaar, nieuwId, nl, plusDagen, vandaag } from "./util.js";

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
// Een variant die anders gewogen wordt (bonen "incl. vocht", `eigen_weging`) telt apart: 340 g
// met vocht is geen 340 g uitgelekte bonen.
export const soortVan = (data, slug) => {
  const i = data.ingredienten[slug];
  return i?.soort && !i.eigen_weging ? i.soort : slug;
};
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

// Wat je koopt voor een receptregel (× factor): {slug: de soort, q: hoeveelheid of null, ing: om
// q mee om te rekenen}, of null als er niets te kopen valt (vrije tekst, of "altijd in huis" zoals
// water). Citroensap "komt uit" citroenen: 2 el sap = ¾ citroen (gram_per.stuk = het sap van één).
export function koopVorm(regel, factor, data) {
  const eigen = data.ingredienten[regel.ingredient];
  if (!eigen || eigen.altijd_in_huis) return null;
  let q = regel.hoeveelheid == null ? null : { hoeveelheid: regel.hoeveelheid * factor, eenheid: regel.eenheid };
  const bron = eigen.komt_uit && data.ingredienten[eigen.komt_uit];
  if (!bron) return { slug: soortVan(data, regel.ingredient), q, ing: ingVan(data, regel.ingredient) };
  if (q) {
    const stuks = omrekenen(q, "stuk", ingVan(data, regel.ingredient), data.eenheden);
    q = stuks == null ? null : { hoeveelheid: stuks, eenheid: "stuk" };
  }
  return { slug: soortVan(data, eigen.komt_uit), q, ing: ingVan(data, eigen.komt_uit) };
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
// Varianten van dezelfde soort tellen samen ("Tofu", niet "Tofu (Jumbo)"), en wat ergens uit
// komt telt bij wat je koopt (citroensap bij citroen, zie koopVorm).
// Regels zonder databasekoppeling ("Pastawater") en water tellen niet mee.
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
      const k = koopVorm(regel, f, data);
      if (!k) continue;
      const ing = ingVan(data, k.slug);
      let x = m.get(k.slug);
      if (!x) m.set(k.slug, (x = { slug: k.slug, ing, nodig: [], zonderHoeveelheid: false, recepten: new Set(), dag }));
      if (dag < x.dag) x.dag = dag;
      x.recepten.add(r.titel);
      if (k.q == null) x.zonderHoeveelheid = true;
      else optellen(x.nodig, k.q, ing, data.eenheden);
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

// De varianten van een soort die als hetzelfde voedsel tellen (alle, behalve wat anders gewogen
// wordt: bonen "incl. vocht" hebben `eigen_weging` en tellen als eigen soort, zie soortVan).
export const variantenVan = (data, soort) => Object.keys(data.ingredienten)
  .filter((x) => data.ingredienten[x].soort === soort && !data.ingredienten[x].eigen_weging);

// Bederft het snel als het open is (kikkererwten, zuivel, verse groente)? Dan is wat na het koken
// over is uit een geopende verpakking waarschijnlijk weggegooid; pasta of rijst blijft gewoon goed.
export const BEDERF_DAGEN = 14;
export const bederftOpen = (ing, data) => bewaren(ing, data).open < BEDERF_DAGEN;

// De verpakkingen waarin je een soort koopt: die van het ingrediënt zelf en van elke variant.
// [{slug, eenheid, gram, gewoon: wat je normaal koopt}]
export function verpakkingen(data, soort) {
  const gen = data.ingredienten[soort];
  if (!gen) return [];
  const gewoon = gen.standaard || soort;
  const uit = [];
  for (const s of [soort, ...variantenVan(data, soort)]) {
    // De soort zelf erft de verpakking van zijn standaardvariant: die telt maar één keer.
    const v = verpakkingVan(s === soort ? gen : ingVan(data, s), data.eenheden);
    if (v) uit.push({ slug: s, eenheid: v[0], gram: v[1], gewoon: s === gewoon });
  }
  return uit.sort((a, b) => b.gewoon - a.gewoon); // wat je normaal koopt eerst
}

// Wat je het best koopt voor `lijst` (hoeveelheden van een soort): de goedkoopste keuze in hele
// verpakkingen. Wat open overblijft telt als weggegooid als het snel bederft (bederftOpen), anders
// houd je het voor later en telt alleen de prijs per kg. Zo goed als gelijk (1%): wat je normaal
// koopt, dan minder verpakkingen. Zonder prijzen telt elke gram even zwaar.
// 400 g kikkererwten → 1 pot (400 g) in plaats van 2 pakken (460 g, 60 g bederft);
// 400 g pasta → de grote zak, als die per kg goedkoper is (de rest blijft goed).
// Met `gewoonAlleen` alleen wat je normaal koopt (vaste voorraad: "3 pakken").
// Geeft [{slug, hoeveelheid, eenheid, gram}], of null (geen verpakking bekend, of niet in gram).
export function besteVerpakking(lijst, soort, data, gewoonAlleen = false) {
  const opties = verpakkingen(data, soort).filter((v) => !gewoonAlleen || v.gewoon);
  const ing = ingVan(data, soort);
  if (!opties.length || !lijst.length || !ing) return null;
  let g = 0;
  for (const q of lijst) {
    const x = gram(q, ing, data.eenheden);
    if (x == null) return null;
    g += x;
  }
  // Wat je los koopt (een citroen, een ui): pas een net of zak als je er minstens een hele nodig hebt.
  if (ing.per_stuk && g < Math.min(...opties.map((v) => v.gram)) * 0.98) return null;
  const nodig = g * 0.98; // een paar procent te weinig is genoeg
  const max = (v) => Math.max(1, Math.ceil(nodig / v.gram - 1e-9));
  const bederft = bederftOpen(ing, data);
  // Prijs per kg per verpakking (zijn eigen product, anders die van de soort; zonder prijs: 1).
  const perKg = (v) => ingVan(data, v.slug)?.prijs_per_kg ?? ing.prijs_per_kg ?? 1;
  let beste = null;
  const kleiner = (a, b) => (Math.abs(a[0] - b[0]) > 0.01 * Math.max(a[0], b[0]) ? a[0] < b[0]
    : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2]);
  const probeer = (keuze) => {
    const totaal = keuze.reduce((s, [v, n]) => s + v.gram * n, 0);
    const prijs = keuze.reduce((s, [v, n]) => s + v.gram * n * perKg(v), 0);
    // Kosten: alles wat je betaalt als de rest bederft, anders alleen het deel dat je gebruikt.
    const kosten = bederft ? prijs : (prijs * g) / totaal;
    const score = [kosten, keuze.every(([v]) => v.gewoon) ? 0 : 1, keuze.reduce((s, [, n]) => s + n, 0)];
    if (!beste || kleiner(score, beste.score)) beste = { keuze, score };
  };
  for (const [i, a] of opties.entries()) {
    probeer([[a, max(a)]]);
    for (const b of opties.slice(i + 1)) {
      for (let na = 1; na < max(a); na++) probeer([[a, na], [b, Math.max(1, Math.ceil((nodig - na * a.gram) / b.gram - 1e-9))]]);
    }
  }
  return beste.keuze.map(([v, n]) => ({ slug: v.slug, hoeveelheid: n, eenheid: v.eenheid, gram: v.gram * n }));
}

// Geschatte prijs van verpakkingen (uit besteVerpakking), elk met de prijs van zijn eigen product.
export function prijsVanPakken(pakken, soort, data) {
  let s = 0;
  for (const p of pakken) {
    const prijs = ingVan(data, p.slug)?.prijs_per_kg ?? ingVan(data, soort)?.prijs_per_kg;
    if (prijs == null) return null;
    s += (p.gram / 1000) * prijs;
  }
  return s;
}

// De verpakking volgens de Jumbo-link van een ingrediënt, zonder iets op te halen:
// ".../jumbo-biologische-kikkererwten-405-g-692551PAK" → {eenheid: "pak", gram: 405}. Of null.
// Een suggestie: bij blikken en potten rekenen recepten met het uitlekgewicht.
const JUMBO_CODE = { ZK: "zak", TAS: "zak", POT: "pot", PAK: "pak", DS: "pak", STK: "pak", FLS: "fles", CAN: "fles",
  BAK: "bak", CUP: "bak", BKR: "bak", TRA: "bak", SC: "bak", EM: "bak", BLK: "blik", NET: "net" };
const LINK_MAAT = { g: 1, gr: 1, gram: 1, kg: 1000, ml: 1, cl: 10, l: 1000, liter: 1000 };
export function pakVanLink(ing) {
  const m = /^https:\/\/www\.jumbo\.com\/producten\/(.+)-\d+([A-Z]+)$/.exec(ing?.product || "");
  if (!m || !JUMBO_CODE[m[2]]) return null;
  const delen = [...m[1].matchAll(/(?:^|-)(\d+)-?(kg|gram|gr|g|ml|cl|liter|l|stuks|st)(?=-|$)/g)];
  const d = delen.at(-1);
  // "40-150g" (van-tot) of "4-x-..." (meerpak): niet te zeggen.
  if (!d || /(?:^|-)(\d+|x)-$/.test(m[1].slice(0, d.index + (d[0].startsWith("-") ? 1 : 0)))) return null;
  const n = Number(d[1]);
  let gram;
  if (d[2] === "stuks" || d[2] === "st") gram = ing.gram_per?.stuk ? n * ing.gram_per.stuk : null;
  else gram = n * LINK_MAAT[d[2]] * (["ml", "cl", "l", "liter"].includes(d[2]) ? ing.dichtheid || 1 : 1);
  if (!(gram > 0)) return null;
  const eenheid = m[2] === "STK" && ["ml", "cl", "l", "liter"].includes(d[2]) ? "fles" : JUMBO_CODE[m[2]];
  return { eenheid, gram: Math.round(gram) };
}

// Alle manieren om een soort te kopen, voor een keuzelijst ("Wat heb je gekocht?"): de
// verpakkingen van het ingrediënt en zijn varianten, en losse eenheden.
// [{waarde: "slug|eenheid", slug, eenheid, gram?, tekst, nieuw?}]
// Met `vrij` (waar ook het gewicht gevraagd en getoond wordt, zoals bij Voorraad): ook een verpakking
// die alleen uit de Jumbo-link bekend is (nieuw: het gewicht staat al ingevuld, je bevestigt het), en
// als er nog geen verpakking bekend is elke verpakking (gewicht invullen). Een geraden gewicht wordt
// dus nooit bewaard zonder dat je het ziet.
export function verpakkingOpties(data, soort, { vrij = false } = {}) {
  const s0 = soortVan(data, soort);
  if (!data.ingredienten[s0]) return [];
  const g = (x) => toonHoeveelheid([{ hoeveelheid: x, eenheid: "g" }]);
  const variantNaam = (s) => (s !== s0 ? ` · ${data.ingredienten[s].naam}` : "");
  const uit = verpakkingen(data, s0).map((v) => ({ slug: v.slug, eenheid: v.eenheid, gram: v.gram,
    tekst: `${v.eenheid} (${g(v.gram)})${variantNaam(v.slug)}` }));
  const slugs = [s0, ...variantenVan(data, s0)];
  for (const s of vrij ? slugs : []) {
    // Alleen als er nog helemaal geen verpakking bekend is (en niet dubbel met de standaardvariant).
    const ing = ingVan(data, s);
    const l = pakVanLink(ing);
    if (!l || verpakkingVan(ing, data.eenheden) || (s === s0 && data.ingredienten[s0].standaard)) continue;
    uit.push({ slug: s, eenheid: l.eenheid, gram: l.gram, nieuw: true, tekst: `${l.eenheid} (${g(l.gram)}, volgens Jumbo)${variantNaam(s)}` });
  }
  const ing = ingVan(data, s0);
  if (ing.gram_per?.stuk || ing.per_stuk) uit.push({ slug: s0, eenheid: "stuk", tekst: "stuks" });
  // ml en l alleen bij iets vloeibaars (dichtheid bekend, of de Jumbo-link noemt ml/liter).
  const vloeibaar = slugs.some((s) => ingVan(data, s).dichtheid || /-\d+-?(ml|cl|l|liter)(-|$)/.test(ingVan(data, s).product || ""));
  for (const e of ["g", "kg", ...(vloeibaar ? ["ml", "l"] : [])]) uit.push({ slug: s0, eenheid: e, tekst: e });
  if (vrij && !uit.some((o) => o.gram && !o.nieuw)) {
    for (const e of Object.keys(data.eenheden).filter((x) => data.eenheden[x].verpakking && !uit.some((o) => o.eenheid === x))) {
      uit.push({ slug: s0, eenheid: e, tekst: `${e} (gewicht invullen)` });
    }
  }
  return uit.map((o) => ({ ...o, waarde: `${o.slug}|${o.eenheid}` }));
}

// De keuze die vooraf geselecteerd staat: een bekende verpakking (van `slug` als die er een
// heeft), dan een uit de Jumbo-link, dan stuks, dan gram.
export function eersteOptie(opties, slug = null) {
  return opties.find((o) => o.slug === slug && o.gram && !o.nieuw) || opties.find((o) => o.gram && !o.nieuw)
    || opties.find((o) => o.nieuw && o.gram) || opties.find((o) => o.eenheid === "stuk") || opties.find((o) => o.eenheid === "g") || opties[0];
}

// Gerechten op het menu die gekookt moeten worden (niet: "uit de voorraad" opeten, niet de
// rest van een kookbeurt die al op het menu staat, en niet wat al gekookt/gegeten is).
export const teKoken = (data) => data.menu.gerechten.filter((g) => g.uit !== "voorraad" && !g.van && !g.gegeten && data.recepten[g.recept]);

// Een gerecht op het menu afvinken (gekookt of gegeten): het blijft grijs in het rooster staan,
// op de dag dat je het at. Was dat een voorbije dag (later ingevuld), dan gaat het weg. Meteen
// opruimen: afgevinkte gerechten en "elders" van voorbije dagen (het rooster toont die niet meer).
// Werkt op het menu-document (in wijzig("menu", …)).
export function afvinken(doc, id, datum = vandaag()) {
  const nu = vandaag();
  for (const g of doc.gerechten) {
    if (g.id !== id) continue;
    g.gegeten = true;
    if (datum >= nu) g.dag = datum;
    else delete g.dag; // voorbij: wordt hieronder opgeruimd
  }
  doc.gerechten = doc.gerechten.filter((g) => !((g.gegeten || g.elders) && (!g.dag || g.dag < nu)));
}

// ---- Maaltijdmomenten ----
export const MOMENTEN = [["ontbijt", "Ontbijt"], ["lunch", "Lunch"], ["diner", "Avondeten"], ["snack", "Tussendoor"]];
export const MOMENT_NAAM = Object.fromEntries(MOMENTEN);
const MOMENT_RANG = Object.fromEntries(MOMENTEN.map(([m], i) => [m, i]));

// Bij welke momenten een recept past: van het recept zelf, anders van het basisrecept (bij een
// variant), anders van de categorie (categorieen.json). Onderdelen (sauzen…) passen nergens.
export function momentenVan(r, data) {
  if (!r) return [];
  if (r.momenten?.length) return r.momenten;
  const basis = r.variant_van && data.recepten[r.variant_van];
  if (basis?.momenten?.length) return basis.momenten;
  return standaardMomenten(r.categorie, data);
}
export const standaardMomenten = (categorie, data) => data.categorieen.find((c) => c.id === categorie)?.momenten || [];

// Het moment van een gerecht op het menu. Zonder moment (van voor het weekrooster):
// avondeten, of het eerste moment waar het recept bij past (overnight oats → ontbijt).
export function momentVan(g, data) {
  if (g.moment) return g.moment;
  const m = momentenVan(data.recepten[g.recept], data);
  return !m.length || m.includes("diner") ? "diner" : m[0];
}

// De rest van een kookbeurt op het menu (gerechten met van = die id).
export const restenVan = (gerechten, id) => gerechten.filter((g) => g.van === id);
const som = (lijst) => lijst.reduce((s, g) => s + g.porties, 0);

// Wat er van een kookbeurt op het menu gebeurt: {nu, resten (porties), vriezer}. Zonder
// `eten` eet je alles wat niet als rest gepland staat meteen op (zoals vóór het weekrooster).
export function kookVerdeling(g, gerechten) {
  const resten = som(restenVan(gerechten, g.id));
  const nu = Math.max(0, Math.min(g.eten ?? g.porties - resten, g.porties - resten));
  return { nu, resten, vriezer: Math.max(0, g.porties - nu - resten) };
}

// De kookbeurt van een recept op het menu (niet: een rest of een portie uit de voorraad), de vroegste eerst.
export const kookbeurtOpMenu = (data, id) => data.menu.gerechten
  .filter((g) => g.recept === id && !g.van && g.uit !== "voorraad" && !g.gegeten)
  .sort((a, b) => (a.dag || "9").localeCompare(b.dag || "9"))[0];

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
      const x = koopVorm(regel, f, data);
      if (!x) continue;
      const g = x.q == null ? null : gram(x.q, x.ing, data.eenheden);
      if (!m.has(x.slug)) m.set(x.slug, []);
      m.get(x.slug).push([k.datum, g ?? SNUFJE]);
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

// Kruiden en specerijen: hooguit eens per zoveel dagen (na het kopen, of na "nog genoeg") de vraag
// "nog genoeg?". De schatting is bij potjes grof, en een herinnering af en toe is genoeg.
export const NAKIJKEN_DAGEN = 30;

// Is deze soort (alle partijen "in huis") naar schatting bijna op? Geeft het geschatte deel, of null.
export function bijnaOp(partijen, data) {
  if (!partijen.length || partijen.some((p) => p.hoeveelheid != null)) return null;
  const ing = ingVan(data, soortVan(data, partijen[0].ingredient));
  if (!ing || ing.altijd_in_huis) return null;
  if (ing.verwaarloosbaar && partijen.some((p) => (p.geteld || p.gekocht) && dagenTot(p.geteld || p.gekocht) > -NAKIJKEN_DAGEN)) return null;
  const f = partijen.map((p) => geschatGebruikt(p, data));
  if (f.some((x) => x == null)) return null;
  const min = Math.min(...f);
  return min >= BIJNA_OP ? min : null;
}

// Vaste voorraad ("altijd minstens 2 pakken kikkererwten in huis"), per soort:
// {soort: {hoeveelheid, eenheid}} uit instellingen.json.
export const minimumVan = (data, slug) => (data.instellingen.minimum || {})[soortVan(data, slug)] || null;

// De boodschappenlijst: één item per ingrediënt, voor alles op het menu, plus de vaste
// voorraad aanvullen, plus wat "in huis" is maar naar schatting bijna op (`bijnaOp`): dat
// krijgt status "nakijken" (de vraag "nog genoeg?", nog niet om te kopen).
// Status per item: "kopen", "nakijken", "genoeg" of "onzeker" (zie vergelijk).
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
    if (x.ing?.altijd_in_huis) continue; // water
    const partijen = partijenVan(data, x.slug);
    let v = vergelijk(x.nodig, partijen, data);
    const op = bijnaOp(partijen, data);
    if (op != null) v = { status: "nakijken", rest: [], bijnaOp: op };
    // Niet voor het menu en niets te kopen of na te kijken: hoort niet op deze lijst.
    if (!x.recepten.size && v.status !== "kopen" && v.status !== "nakijken") continue;
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
// open is, dan een dichte verpakking die binnen een paar dagen op moet, dan de dichte partij
// waarvan het minst open overblijft (400 g kikkererwten: de pot van 400 g, niet twee pakken van
// 230 g), bij gelijkspel de oudste. Wordt een verpakking (of een ui, een aubergine) maar half
// gebruikt, dan wordt de rest een open partij, op de plek waar die na openen hoort.
// De partijen mogen van verschillende merken van dezelfde soort zijn; elke partij rekent met
// zijn eigen merk. Een zak uien of een net citroenen gaat niet open: die wordt losse stuks
// (zie uitpakken), en wat in gram over is (aardappelen, wortelen) blijft dicht.
// Geeft {partijen: nieuwe lijst, gelukt: of er iets afgeboekt kon worden}.
export function afboeken(partijen, nodig, data, datum = vandaag()) {
  const { eenheden } = data;
  const lijst = partijen.map((p) => ({ ...p }));
  const volgorde = lijst.filter((p) => p.hoeveelheid != null).sort(opmaakVolgorde);
  const gauw = (p) => { const d = opTegen(p, data); return !!d && dagenTot(d) <= GAUW; };
  // Hoeveel er (in de eenheid van q) open overblijft als je `rest` uit p haalt, of null als p
  // het niet alleen kan. Wat open niet bederft (pasta, rijst) telt als 0: dan gewoon de oudste.
  // Rekent op een kopie: p zelf verandert niet.
  const openOver = (p, rest, q) => {
    const ing = ingVan(data, p.ingredient);
    if (!ing || !(p.hoeveelheid > 0)) return null;
    const x = { ...p };
    uitpakken(x, ing, eenheden);
    const beschikbaar = omrekenen({ hoeveelheid: x.hoeveelheid, eenheid: x.eenheid }, q.eenheid, ing, eenheden);
    if (beschikbaar == null || beschikbaar < rest - 1e-9) return null;
    if (!bederftOpen(ing, data)) return 0;
    if (!telbaar(x.eenheid, eenheden)) return perStuk(ing) ? 0 : beschikbaar - rest;
    const neemP = (rest / beschikbaar) * x.hoeveelheid;
    return ((Math.ceil(neemP - 1e-6) - neemP) * beschikbaar) / x.hoeveelheid;
  };
  let gelukt = false;
  for (const q of nodig) {
    let rest = q.hoeveelheid;
    const gehad = new Set();
    while (rest > 1e-9) {
      const kandidaten = volgorde.filter((p) => !gehad.has(p) && p.hoeveelheid > 0);
      let p = kandidaten.find((x) => x.geopend) || kandidaten.find(gauw);
      if (!p) {
        const passend = kandidaten.map((x) => [x, openOver(x, rest, q)]).filter(([, o]) => o != null);
        p = passend.reduce((a, b) => (b[1] < a[1] - 1e-6 ? b : a), passend[0] || [kandidaten[0]])[0];
      }
      if (!p) break;
      gehad.add(p);
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

// Gekochte boodschappen als nieuwe partij in de voorraad (past `partijen` aan). `slug` mag een
// variant zijn (de pot kikkererwten); `plek` leeg = waar het normaal hoort.
// Komt bij een dichte partij van dezelfde dag, plek en eenheid.
export function inVoorraad(partijen, slug, gekocht, data, datum = vandaag(), plek = null) {
  const { eenheden } = data;
  const ing = ingVan(data, slug);
  if (ing.altijd_in_huis) return;
  const tellen = ing.verwaarloosbaar ? [] : gekocht.filter((q) => voorraadEenheden(eenheden).includes(q.eenheid));
  const q = tellen.length === 1 && tellen.length === gekocht.length ? tellen[0] : null;
  plek ||= standaardPlek(ing, data);
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
// Optioneel voor een aantal porties en een keuze (de receptpagina); anders het recept zoals het is.
export function dekking(recept, data, porties = null, keuze = null) {
  let totaal = 0;
  const ontbreekt = [], gauw = [];
  const g = { recept: recept.id, ...(porties != null ? { porties } : {}), ...(keuze ? { keuze } : {}) };
  for (const x of benodigd([g], data, bewaardeOnderdelen(data)).values()) {
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
  // Een rest is hetzelfde gerecht; wat al gegeten is, staat al in het logboek.
  for (const g of data.menu.gerechten) if (!g.van && !g.gegeten) tel(g.recept);
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

// ---- Weekplan voorstellen ----
// Hoe lang een rest uit de koelkast nog op het menu mag (dagen na het koken).
const REST_DAGEN = BEWAARDAGEN.koelkast;
const dagenTussen = (a, b) => dagenTot(b) - dagenTot(a);
const vakSleutel = (dag, moment) => `${dag}|${moment}`;
const basisId = (data, id) => data.recepten[id]?.variant_van || id;

// Met hoeveel mensen je eet (keuze in het weekplan-venster).
export const etersPerMaaltijd = (data) => data.instellingen.planner?.eters || 1;

// Kookbeurten op het menu waarvan je in vak (dag, moment) een rest kunt eten: eerder gekookt
// (een eerdere dag, hooguit REST_DAGEN ervoor, of eerder op dezelfde dag) en nog niet afgevinkt.
export function restKandidaten(data, dag, moment) {
  return data.menu.gerechten.filter((g) => g.dag && !g.van && g.uit !== "voorraad" && !g.gegeten && data.recepten[g.recept]?.porties
    && (g.dag < dag ? dagenTussen(g.dag, dag) <= REST_DAGEN : g.dag === dag && MOMENT_RANG[momentVan(g, data)] < MOMENT_RANG[moment]))
    .sort((a, b) => a.dag.localeCompare(b.dag) || MOMENT_RANG[momentVan(a, data)] - MOMENT_RANG[momentVan(b, data)]);
}

// Een rest (n porties) van kookbeurt `kookId` in vak (dag, moment) zetten; werkt op het
// menu-document. Wat je bij het koken zelf eet: `eten`, anders (zonder resten) n porties.
// Zijn er niet genoeg porties, dan kook je meer. Geeft {porties, meer} of null.
export function restErbij(doc, kookId, dag, moment, n) {
  const k = doc.gerechten.find((x) => x.id === kookId);
  if (!k) return null;
  const resten = som(restenVan(doc.gerechten, k.id));
  const nu = k.eten ?? (resten ? k.porties - resten : Math.min(n, k.porties));
  const meer = nu + resten + n > k.porties;
  if (meer) k.porties = nu + resten + n;
  doc.gerechten.push({ id: nieuwId(), recept: k.recept, porties: n, dag, moment, van: k.id, ...(k.keuze ? { keuze: k.keuze } : {}) });
  // 'eten' alleen bewaren als er iets naar de vriezer gaat (zie kookVerdeling).
  if (nu + resten + n < k.porties) k.eten = nu; else delete k.eten;
  return { porties: k.porties, meer };
}

// Waar de resten van een kookbeurt `g` (met dag) heen kunnen: de eerstvolgende vrije vakken
// (geen gerecht, geen "elders") binnen REST_DAGEN dagen, bij een moment dat bij het gerecht past
// en dat je laat invullen (weekplan-keuze, anders lunch en avondeten), niet twee keer op een dag.
// Zelfde regel als het weekplan. `bezet`: extra vakken ("dag|moment") die al gekozen zijn.
// Geeft hooguit n vakken [{dag, moment}].
export function restVoorstel(data, g, n, bezet = []) {
  const momenten = (data.instellingen.planner?.momenten || ["lunch", "diner"])
    .filter((m) => momentenVan(data.recepten[g.recept], data).includes(m))
    .sort((a, b) => MOMENT_RANG[a] - MOMENT_RANG[b]);
  const vol = new Set([...bezet, ...data.menu.gerechten.filter((x) => x.dag && x.id !== g.id)
    .map((x) => vakSleutel(x.dag, x.elders ? x.moment : momentVan(x, data)))]);
  const dagenMet = new Set([...bezet.map((s) => s.split("|")[0]), ...data.menu.gerechten
    .filter((x) => x.dag && x.id !== g.id && x.van !== g.id && basisId(data, x.recept) === basisId(data, g.recept)).map((x) => x.dag)]);
  const uit = [];
  for (let na = 1; na <= REST_DAGEN && uit.length < n; na++) {
    const dag = plusDagen(g.dag, na);
    if (dag < vandaag() || dagenMet.has(dag)) continue;
    const m = momenten.find((x) => !vol.has(vakSleutel(dag, x)));
    if (m) uit.push({ dag, moment: m });
  }
  return uit;
}

// Een kookbeurt in een kopie van de gegevens "uitvoeren": ingrediënten en gebruikte
// onderdelen gaan uit de voorraad van de kopie, zodat het volgende gerecht ziet wat er over is.
function kookInKopie(kopie, g) {
  const onderdelen = bewaardeOnderdelen(kopie);
  for (const x of benodigd([g], kopie, onderdelen).values()) {
    if (!x.nodig.length) continue;
    const vanSoort = (p) => soortVan(kopie, p.ingredient) === x.slug;
    const partijen = kopie.voorraad.ingredienten.filter(vanSoort);
    if (!partijen.some((p) => p.hoeveelheid != null)) continue;
    const af = afboeken(partijen, x.nodig, kopie);
    if (af.gelukt) kopie.voorraad.ingredienten = [...kopie.voorraad.ingredienten.filter((p) => !vanSoort(p)), ...af.partijen];
  }
  onderdelenAfnemen(kopie.voorraad.porties, onderdelen.gebruikt, kopie);
}

// Hoe goed een gerecht nu past: één score voor de suggesties, het kiesvenster en het weekplan,
// zodat een gerecht overal even hoog staat. Lang niet gegeten (tot 60 dagen), afwisseling deze week,
// wat gauw op moet, wat in huis is, en (een duwtje) aanbiedingen.
// ctx: {week: dezeWeek(), laatst: laatstGegeten(), dag?: wanneer je het eet, metVoorraad, cache?: Map}
// Geeft {score, l: laatst gegeten, dek: dekking, ov: overlap, actie: aanbiedingen}.
export function gerechtScore(r, data, ctx) {
  const l = ctx.laatst[r.id];
  const dek = dekking(r, data);
  const ov = overlap(r, data, ctx.week);
  const dag = ctx.dag || vandaag();
  let score = Math.min(l ? -dagenTot(l.datum) : 60, 60) - 8 * ov.score;
  score += 12 * dek.gauw.filter((x) => dag <= x.datum).length;
  if (ctx.metVoorraad && dek.totaal) score += dek.ontbreekt.length ? -2 * dek.ontbreekt.length : 6;
  const actie = inDeAanbieding(r, data, ctx.dag || plusDagen(vandaag(), 6), ctx.cache);
  score += Math.min(12, 6 * actie.length);
  return { score, l, dek, ov, actie };
}

// Het eerste vrije vak vanaf vandaag (twee weken vooruit) bij een moment dat bij het recept past
// en dat je plant (weekplan-keuze, anders lunch en avondeten): {dag, moment}.
export function eersteVrijVak(data, recept) {
  const past = momentenVan(recept, data);
  const gepland = data.instellingen.planner?.momenten || ["lunch", "diner"];
  const momenten = MOMENTEN.map(([m]) => m).filter((m) => past.includes(m) && gepland.includes(m));
  const kies = momenten.length ? momenten : past.length ? past : ["diner"];
  const vol = new Set(data.menu.gerechten.filter((g) => g.dag).map((g) => vakSleutel(g.dag, g.elders ? g.moment : momentVan(g, data))));
  for (let n = 0; n < 14; n++) {
    const dag = plusDagen(vandaag(), n);
    const m = kies.find((x) => !vol.has(vakSleutel(dag, x)));
    if (m) return { dag, moment: m };
  }
  return { dag: vandaag(), moment: kies[0] };
}

// Waarom dit gerecht: korte zinnen voor op het voorstel.
export function redenenVoor(r, laatst, dek, metVoorraad, dag, actie = []) {
  const uit = [laatst ? `Laatst gegeten ${geleden(laatst.datum)}` : "Nog niet gegeten"];
  const gauw = dek.gauw.filter((x) => dag <= x.datum);
  if (gauw.length) uit.push(`Gebruikt ${gauw.map((x) => `${x.naam.toLowerCase()} (${x.open ? "open, " : ""}${houdbaar(x.datum)})`).join(", ")}`);
  if (metVoorraad && dek.totaal) {
    const n = dek.ontbreekt.length;
    uit.push(!n ? "Alles in huis" : n <= 3 ? `Nog kopen: ${dek.ontbreekt.join(", ").toLowerCase()}` : `Nog ${n} van ${dek.totaal} ingrediënten kopen`);
  }
  if (actie.length) uit.push(actieReden(actie));
  return uit;
}

// ---- Aanbiedingen ----
// data/aanbiedingen.json: wat er bij AH en Jumbo in de aanbieding is voor gekoppelde producten
// (het product en de alternatieven van een ingrediënt en zijn varianten), met de prijs per kg.
// Alleen opgehaald als je op de knop drukt (Boodschappen, laptop). Geen bestand = geen
// aanbiedingen, en dan werkt alles gewoon zoals zonder. Elke aanbieding geldt van `vanaf` t/m `tot`.
// Eén regel overal: een aanbieding telt als hij per kg minstens VOORDEEL % goedkoper is dan wat
// je normaal betaalt (de prijs van de soort, dus van de standaardvariant).
export const WINKEL_NAAM = { jumbo: "Jumbo", ah: "AH" };
export const VOORDEEL = 10;
const alleAanbiedingen = (data) => data.aanbiedingen?.aanbiedingen || [];
export const heeftAanbiedingen = (data) => alleAanbiedingen(data).some((a) => a.tot >= vandaag());
export const aanbiedingTekst = (a) => `${WINKEL_NAAM[a.winkel] || a.winkel}: ${a.actie}`;
// De gewone prijs per kg waarmee een aanbieding vergeleken wordt (of null).
export const normaalPrijs = (data, a) => ingVan(data, soortVan(data, a.ingredient))?.prijs_per_kg ?? null;
// Hoeveel procent goedkoper dan normaal (0 als dat niet te zeggen is).
export function voordeelVan(data, a) {
  const normaal = normaalPrijs(data, a);
  return a.per_kg > 0 && normaal > 0 ? (1 - a.per_kg / normaal) * 100 : 0;
}

// Aanbiedingen die tellen voor een soort en ergens tussen `van` en `tot` gelden, grootste voordeel eerst.
export function aanbiedingenVan(data, slug, van = vandaag(), tot = van) {
  return alleAanbiedingen(data)
    .filter((a) => data.ingredienten[a.ingredient] && soortVan(data, a.ingredient) === slug && a.vanaf <= tot && a.tot >= van)
    .map((a) => ({ a, v: voordeelVan(data, a) }))
    .filter((x) => x.v >= VOORDEEL)
    .sort((x, y) => y.v - x.v)
    .map((x) => x.a);
}

// De ingrediënten van een recept die ertoe doen (geen zout en kruiden): [{slug, naam}].
function soortenVan(r, data, cache) {
  if (cache?.has(r.id)) return cache.get(r.id);
  const uit = [...benodigd([{ recept: r.id }], data).values()]
    .filter((x) => !x.ing.verwaarloosbaar).map((x) => ({ slug: x.slug, naam: x.ing.naam }));
  cache?.set(r.id, uit);
  return uit;
}

// Wat er van een recept in de aanbieding is als je tussen vandaag en `dag` boodschappen doet:
// [{naam, a}]. `cache` (een Map) scheelt rekenwerk als je dit voor veel vakken vraagt.
export function inDeAanbieding(r, data, dag = plusDagen(vandaag(), 6), cache = null) {
  if (!heeftAanbiedingen(data)) return [];
  return soortenVan(r, data, cache)
    .map(({ slug, naam }) => ({ naam, a: aanbiedingenVan(data, slug, vandaag(), dag)[0] }))
    .filter((x) => x.a);
}

// Kort, voor op een kaart: [{naam, procent (goedkoper dan normaal), uitleg}], grootste voordeel eerst.
export const actieKort = (actie, data) => actie.map((x) => ({
  naam: x.naam.replace(/\s*\(.*?\)/g, "").toLowerCase(),
  procent: Math.round(voordeelVan(data, x.a)),
  uitleg: `${aanbiedingTekst(x.a)}, t/m ${datumNl(x.a.tot)}`,
})).sort((a, b) => b.procent - a.procent);
// Eén regel, voor de redenen bij een voorstel: "Aanbieding: tofu, aardappelen".
export const actieReden = (actie) => `Aanbieding: ${actie.map((x) => x.naam.replace(/\s*\(.*?\)/g, "").toLowerCase()).join(", ")}`;

// "Slim inslaan": wat nu in de aanbieding is, lang goed blijft (kast, vriezer) en wat je echt
// gebruikt (vaste voorraad, of in iets wat je de laatste 60 dagen kookte). Niet wat al op de
// lijst staat (daar staat de aanbieding al bij). Hooguit 3, grootste voordeel eerst.
export function koopAdvies(data, lijst) {
  if (!heeftAanbiedingen(data)) return [];
  const opLijst = new Set(lijst.filter((x) => x.status === "kopen").map((x) => x.slug));
  const gebruikt = new Set(Object.keys(data.instellingen.minimum || {}).map((s) => soortVan(data, s)));
  const grens = plusDagen(vandaag(), -60);
  const gezien = new Set();
  for (const k of data.logboek.gekookt || []) {
    if (k.datum < grens || gezien.has(k.recept) || !data.recepten[k.recept]) continue;
    gezien.add(k.recept);
    for (const s of soortenVan(data.recepten[k.recept], data)) gebruikt.add(s.slug);
  }
  const uit = [];
  for (const slug of gebruikt) {
    const ing = ingVan(data, slug);
    if (!ing || opLijst.has(slug)) continue;
    const b = bewaren(ing, data);
    if (!(b.plek === "vriezer" || b.dagen >= 30)) continue;
    // Ook wat over een paar dagen begint (Jumbo wisselt op woensdag, AH op maandag).
    const a = aanbiedingenVan(data, slug, vandaag(), plusDagen(vandaag(), 3))[0];
    if (a) uit.push({ slug, ing, a });
  }
  return uit.sort((x, y) => voordeelVan(data, y.a) - voordeelVan(data, x.a)).slice(0, 3);
}

// Stelt een menu voor de komende dagen voor. Niets wordt opgeslagen.
// opties: {begin, dagen, eters, momenten: welke vakken invullen, uitgesloten: Set recepten,
//   vast: voorstellen die blijven staan (uit een vorige ronde; met aan: false = afgewezen,
//   dat vak blijft dan leeg), ronde: 0, 1, 2… ("Opnieuw voorstellen" geeft een ander plan)}.
// Geeft [{tid, recept, porties, dag, moment, keuze?, eten?, van?, uit?, redenen}]:
//   een kookbeurt (eten = porties bij die maaltijd), een rest daarvan (van = tid van de
//   kookbeurt) of een bewaarde portie uit de koelkast (uit: "voorraad").
// Werkwijze: eerst wat al gekookt in de koelkast ligt; dan per vak, in volgorde van de tijd,
// het gerecht met de beste score (lang niet gegeten, afwisseling, wat gauw op moet, wat in
// huis is); de porties die overblijven gaan naar volgende lunches/avondeten binnen 3 dagen.
export function stelPlanVoor(data, opties = {}) {
  const { begin = vandaag(), dagen = 7, eters = 1, momenten = ["lunch", "diner"], vast = [], ronde = 0 } = opties;
  const uitgesloten = new Set(opties.uitgesloten || []);
  const dagLijst = Array.from({ length: dagen }, (_, n) => plusDagen(begin, n));
  const volgorde = MOMENTEN.map(([m]) => m).filter((m) => momenten.includes(m));
  // `alleen`: ["dag|moment", …] = alleen deze vakken invullen (na "Ik eet hier niet").
  const alleen = opties.alleen && new Set(opties.alleen);
  const vakken = dagLijst.flatMap((dag) => volgorde.map((moment) => ({ dag, moment })))
    .filter((v) => !alleen || alleen.has(vakSleutel(v.dag, v.moment)));

  // Werken op een kopie: het menu krijgt de voorstellen erbij, de voorraad raakt op.
  // "Elders" (geen recept) houdt alleen zijn vak bezet.
  const kopie = { ...data,
    menu: { gerechten: data.menu.gerechten.filter((g) => g.elders || data.recepten[g.recept]) },
    voorraad: { ingredienten: data.voorraad.ingredienten.map((p) => ({ ...p })),
      porties: data.voorraad.porties.map((p) => ({ ...p })) } };
  const bezet = new Set();
  const gebruikt = new Set(); // basisrecepten die al op het menu of in dit plan staan
  const opDag = new Set(); // "dag|basisrecept": niet twee keer hetzelfde op één dag
  const neem = (g) => {
    if (g.dag) bezet.add(vakSleutel(g.dag, momentVan(g, data)));
    if (g.elders) return;
    gebruikt.add(basisId(data, g.recept));
    if (g.dag) opDag.add(`${g.dag}|${basisId(data, g.recept)}`);
  };
  for (const g of kopie.menu.gerechten) neem(g);
  // Wat al gepland is, gaat al van de voorraad af.
  for (const g of teKoken(kopie)) kookInKopie(kopie, g);
  const uitVoorraadGepland = new Map();
  for (const g of kopie.menu.gerechten) {
    if (g.uit === "voorraad" && !g.gegeten) uitVoorraadGepland.set(g.recept, (uitVoorraadGepland.get(g.recept) || 0) + g.porties);
  }

  const uit = [];
  let teller = 0;
  const tid = () => `${opties.sleutel || `v${ronde}`}-${++teller}`; // sleutel: uniek per aanroep
  // Vorige ronde: blijft staan. Afgewezen vakken (✗ = "hier eet ik niet") blijven leeg; het
  // gerecht zelf mag nog wel ergens anders ("Ander gerecht" sluit een gerecht uit).
  for (const v of vast) {
    bezet.add(vakSleutel(v.dag, v.moment));
    if (v.aan !== false) {
      neem(v);
      if (!v.van && !v.uit) kookInKopie(kopie, v);
      if (v.uit === "voorraad") uitVoorraadGepland.set(v.recept, (uitVoorraadGepland.get(v.recept) || 0) + v.porties);
      kopie.menu.gerechten.push({ ...v, id: v.tid });
    }
    uit.push(v);
  }
  const vrij = (dag, moment) => !bezet.has(vakSleutel(dag, moment));

  // 1. Wat al gekookt in de koelkast ligt eerst opeten (de vriezer blijft staan).
  const inKoelkast = new Map();
  for (const p of bewaardePorties(kopie)) {
    if (p.plek !== "koelkast" || !momentenVan(data.recepten[p.recept], data).length) continue;
    inKoelkast.set(p.recept, (inKoelkast.get(p.recept) || 0) + p.aantal);
  }
  for (const [recept, aantal] of inKoelkast) {
    let rest = aantal - (uitVoorraadGepland.get(recept) || 0);
    const past = momentenVan(data.recepten[recept], data);
    for (const vak of vakken) {
      if (rest < 0.5) break;
      if (!past.includes(vak.moment) || !vrij(vak.dag, vak.moment) || opDag.has(`${vak.dag}|${basisId(data, recept)}`)) continue;
      const n = Math.min(eters, Math.round(rest));
      const g = { tid: tid(), recept, porties: n, dag: vak.dag, moment: vak.moment, uit: "voorraad", redenen: ["Ligt al klaar in de koelkast"] };
      neem(g);
      kopie.menu.gerechten.push({ ...g, id: g.tid });
      uit.push(g);
      rest -= n;
    }
  }

  // 2. Per vak het beste gerecht kiezen, en de rest ervan verdelen.
  const onderdeel = new Set(data.categorieen.filter((c) => c.onderdeel).map((c) => c.id));
  const kandidaten = Object.values(data.recepten).filter((r) => !r.variant_van && !onderdeel.has(r.categorie) && r.porties);
  const laatst = laatstGegeten(data);
  const metVoorraad = data.voorraad.ingredienten.length > 0;
  const ruis = ronde ? 15 : 3; // bij "opnieuw voorstellen" mag het meer verschillen
  const soorten = new Map(); // ingrediënten per recept, voor de aanbiedingen
  for (const vak of vakken) {
    if (!vrij(vak.dag, vak.moment)) continue;
    const week = dezeWeek(kopie);
    let beste = null;
    for (const r of kandidaten) {
      if (gebruikt.has(r.id) || uitgesloten.has(r.id) || !momentenVan(r, data).includes(vak.moment)) continue;
      const s = gerechtScore(r, kopie, { week, laatst, dag: vak.dag, metVoorraad, cache: soorten });
      const score = s.score + (dagwaarde(`${r.id}|${ronde}|${vak.dag}|${vak.moment}`) % 1000) / 1000 * ruis;
      if (!beste || score > beste.score) beste = { r, ...s, score };
    }
    if (!beste) continue;
    const { r } = beste;
    const porties = r.porties * Math.max(1, Math.ceil(eters / r.porties));
    const keuze = r.keuzes?.opties?.[0]?.id;
    const kook = { tid: tid(), recept: r.id, porties, eten: Math.min(eters, porties), dag: vak.dag, moment: vak.moment,
      ...(keuze ? { keuze } : {}), redenen: redenenVoor(r, beste.l, beste.dek, metVoorraad, vak.dag, beste.actie) };
    neem(kook);
    kopie.menu.gerechten.push({ ...kook, id: kook.tid });
    kookInKopie(kopie, kook);
    uit.push(kook);
    // De rest: volgende vakken waar het gerecht bij past, binnen een paar dagen, niet twee keer op een dag.
    let rest = porties - kook.eten;
    const past = momentenVan(r, data);
    for (const v of vakken) {
      if (rest <= 0) break;
      const na = dagenTussen(vak.dag, v.dag);
      if (na < 1 || na > REST_DAGEN || !past.includes(v.moment) || !vrij(v.dag, v.moment) || opDag.has(`${v.dag}|${r.id}`)) continue;
      const n = Math.min(eters, rest);
      const g = { tid: tid(), recept: r.id, porties: n, dag: v.dag, moment: v.moment, van: kook.tid, ...(keuze ? { keuze } : {}), redenen: [] };
      neem(g);
      kopie.menu.gerechten.push({ ...g, id: g.tid });
      uit.push(g);
      rest -= n;
    }
  }
  return uit.sort((a, b) => a.dag.localeCompare(b.dag) || MOMENT_RANG[a.moment] - MOMENT_RANG[b.moment]);
}
