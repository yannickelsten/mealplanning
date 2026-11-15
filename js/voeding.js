// Rekenregels voor voedingswaarden. Gelijk houden met tools/mealdata.py.

export const VOEDING_KEYS = ["kcal", "vet", "koolhydraten", "eiwit"];

// Het ingrediënt om mee te rekenen. Een algemene soort ("Tofu") met een `standaard`-variant
// neemt alles wat hij zelf niet invult over van die variant (voedingswaarde, prijs, gewicht
// per stuk/verpakking…). Gelijk houden met reken_ing in tools/mealdata.py.
export function rekenIng(ingredienten, slug) {
  const ing = ingredienten[slug];
  const v = ing?.standaard && ingredienten[ing.standaard];
  if (!v) return ing;
  const eigen = Object.fromEntries(Object.entries(ing).filter(([, w]) => w != null));
  return { ...v, ...eigen, gram_per: { ...(v.gram_per || {}), ...(ing.gram_per || {}) } };
}

export function gram(regel, ing, eenheden) {
  const h = regel.hoeveelheid, e = regel.eenheid;
  if (h == null || e == null) return null;
  const per = ing.gram_per?.[e];
  if (per != null) return h * per;
  const eh = eenheden[e] || {};
  if (eh.gram != null) return h * eh.gram;
  if (eh.ml != null) return h * eh.ml * (ing.dichtheid || 1);
  return null;
}

export function* regels(recept, keuze) {
  for (const stap of recept.stappen || []) yield* stap.ingredienten || [];
  const opties = recept.keuzes?.opties || [];
  if (opties.length) {
    const optie = opties.find((o) => o.id === keuze) || opties[0];
    yield* optie.ingredienten || [];
  }
}

function leeg() {
  return { kcal: 0, vet: 0, koolhydraten: 0, eiwit: 0, kosten: 0, gram: 0,
           onvolledig: new Set(), zonder_prijs: new Set() };
}

export function voeding(recept, data, keuze, stapel = []) {
  const t = leeg();
  const { ingredienten, eenheden, recepten } = data;
  for (const regel of regels(recept, keuze)) {
    if (regel.recept) {
      const sub = recepten[regel.recept];
      if (!sub || stapel.includes(sub.id)) {
        t.onvolledig.add(regel.naam || regel.recept);
        continue;
      }
      const st = voeding(sub, data, regel.keuze, [...stapel, recept.id]);
      let factor = regel.hoeveelheid ?? 1;
      if (regel.eenheid === "portie") factor /= sub.porties || 1;
      else if (regel.eenheid != null && regel.eenheid !== "keer") {
        // in gram/ml: deel van het totale (rauwe) gewicht van het deelrecept
        const g = gram(regel, {}, eenheden);
        const totaalG = sub.opbrengst_g || st.gram;
        if (g == null || !totaalG) {
          t.onvolledig.add(regel.naam || sub.titel);
          continue;
        }
        factor = g / totaalG;
      }
      for (const k of [...VOEDING_KEYS, "kosten", "gram"]) t[k] += st[k] * factor;
      st.onvolledig.forEach((x) => t.onvolledig.add(x));
      st.zonder_prijs.forEach((x) => t.zonder_prijs.add(x));
      continue;
    }
    const ing = rekenIng(ingredienten, regel.ingredient);
    if (!ing || regel.hoeveelheid == null) continue;
    const g = gram(regel, ing, eenheden);
    if (g != null) t.gram += g;
    if (ing.verwaarloosbaar) continue;
    if (g == null || ing.per_100g == null) {
      t.onvolledig.add(ing.naam);
      continue;
    }
    for (const k of VOEDING_KEYS) t[k] += (ing.per_100g[k] * g) / 100;
    if (ing.prijs_per_kg != null) t.kosten += (ing.prijs_per_kg * g) / 1000;
    else t.zonder_prijs.add(ing.naam);
  }
  return t;
}

export function afgeleideTags(recept, data, stapel = []) {
  const eiwit = new Set(), groente = new Set();
  let vlees = false;
  for (const regel of regels(recept)) {
    if (regel.recept) {
      const sub = data.recepten[regel.recept];
      if (sub && !stapel.includes(sub.id)) {
        const s = afgeleideTags(sub, data, [...stapel, recept.id]);
        s.eiwit.forEach((x) => eiwit.add(x));
        s.groente.forEach((x) => groente.add(x));
        vlees = vlees || !s.vegetarisch;
      }
      continue;
    }
    const ing = rekenIng(data.ingredienten, regel.ingredient);
    if (!ing) continue;
    vlees = vlees || !!ing.vlees;
    if (ing.tag && (ing.rol === "eiwitbron" || ing.rol === "peulvrucht")) eiwit.add(ing.tag);
    else if (ing.tag && ing.rol === "groente") groente.add(ing.tag);
  }
  return { eiwit: [...eiwit].sort(), groente: [...groente].sort(), vegetarisch: !vlees };
}
