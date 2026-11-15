export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const BREUK = { 0.25: "¼", 0.5: "½", 0.75: "¾" };

// 1.5 -> "1½", 0.25 -> "¼", 0.1 -> "0,1"
export function breuk(v) {
  const q = Math.round(v * 4) / 4;
  if (q === 0) return nl(v, 1);
  const heel = Math.floor(q);
  const rest = q - heel;
  return (heel || "") + (BREUK[rest] || "") || "0";
}

export const nl = (v, dec = 0) =>
  Number(v).toLocaleString("nl-NL", { maximumFractionDigits: dec, minimumFractionDigits: 0 });

export const euro = (v) =>
  v.toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

function rondMaat(v) {
  if (v >= 100) return Math.round(v / 5) * 5;
  if (v >= 10) return Math.round(v);
  return Math.round(v * 2) / 2;
}

// Hoeveelheid zoals op de kaarten: "375g", "1½ el", "2", "snufje".
export function hoeveelheid(regel, factor = 1) {
  const h = regel.hoeveelheid, e = regel.eenheid;
  if (h == null) return "";
  const v = h * factor;
  if (["g", "ml", "kg", "l"].includes(e)) return `${nl(rondMaat(v), 1)}${e}`;
  if (e === "stuk") return breuk(v);
  if (e === "keer") return `${breuk(v)}×`;
  if (["snufje", "scheut", "handje"].includes(e) && Math.abs(v - 1) < 0.01) return e;
  return `${breuk(v)} ${e}`;
}

export const groepNaam = (g) => {
  const t = g.replace(/-en-/g, " & ").replace(/-/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function slugVan(tekst) {
  return tekst
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const nieuwId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const twee = (n) => String(n).padStart(2, "0");

// Datum van vandaag als "2026-11-15" (lokale tijd).
export function vandaag() {
  const d = new Date();
  return `${d.getFullYear()}-${twee(d.getMonth() + 1)}-${twee(d.getDate())}`;
}

const dagnummer = (iso) => {
  const [j, m, d] = iso.split("-").map(Number);
  return Date.UTC(j, m - 1, d) / 864e5;
};

// Datum + n dagen, als "2026-11-20".
export function plusDagen(iso, n) {
  const d = new Date(Date.UTC(...iso.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) + n * 864e5);
  return d.toISOString().slice(0, 10);
}

// De maandag van de week waarin `iso` valt.
export function maandagVan(iso) {
  const [j, m, d] = iso.split("-").map(Number);
  const dag = new Date(Date.UTC(j, m - 1, d)).getUTCDay(); // 0 = zondag
  return plusDagen(iso, -((dag + 6) % 7));
}

// Aantal dagen van vandaag tot `iso` (negatief = in het verleden).
export const dagenTot = (iso) => dagnummer(iso) - dagnummer(vandaag());

// "za 15 nov"; in een ander jaar "15 nov 2027"
export function datumNl(iso) {
  const [j, m, d] = iso.split("-").map(Number);
  const opties = j === new Date().getFullYear()
    ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
  return new Date(j, m - 1, d).toLocaleDateString("nl-NL", opties);
}

// "maandag"
export const weekdag = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long" });

// "vandaag", "gisteren", "5 dagen geleden", "3 weken geleden", "2 maanden geleden"
export function geleden(iso) {
  const n = -dagenTot(iso);
  if (n <= 0) return "vandaag";
  if (n === 1) return "gisteren";
  if (n < 14) return `${n} dagen geleden`;
  if (n < 61) return `${Math.round(n / 7)} weken geleden`;
  return `${Math.round(n / 30)} maanden geleden`;
}

// Duur in dagen als tekst: "vandaag", "1 dag", "5 dagen", "3 weken", "4 maanden".
export function duur(n) {
  if (n <= 0) return "vandaag";
  if (n === 1) return "1 dag";
  if (n < 14) return `${n} dagen`;
  if (n < 61) return `${Math.round(n / 7)} weken`;
  return `${Math.round(n / 30)} maanden`;
}

// Houdbaarheid: "over datum", "vandaag", "morgen", "nog 3 dagen", of een datum.
export function houdbaar(iso) {
  const n = dagenTot(iso);
  if (n < 0) return "over datum";
  if (n === 0) return "vandaag";
  if (n === 1) return "morgen";
  if (n <= 7) return `nog ${n} dagen`;
  return `tht ${datumNl(iso)}`;
}

// Korte melding onderaan. Met `ongedaan` (een functie die de actie terugdraait) komt er een
// knop "Ongedaan maken" bij en blijft de melding langer staan; daarna wordt de pagina
// opnieuw getekend.
export function melding(tekst, ongedaan = null) {
  document.querySelectorAll(".melding").forEach((x) => x.remove());
  const el = document.createElement("div");
  el.className = "melding";
  el.textContent = tekst;
  if (ongedaan) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Ongedaan maken";
    b.addEventListener("click", async () => {
      el.remove();
      try {
        await ongedaan();
        window.dispatchEvent(new Event("tekenen"));
        melding("Ongedaan gemaakt");
      } catch (err) {
        melding(err.message);
      }
    });
    el.append(b);
  }
  document.body.append(el);
  setTimeout(() => el.remove(), ongedaan ? 8000 : 2500);
}
