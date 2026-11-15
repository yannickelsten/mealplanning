// Kookstand: één stap per scherm, grote letters, scherm blijft aan, met kookwekker.
import { regels } from "../voeding.js";
import { kookbeurtOpMenu } from "../planning.js";
import { esc, hoeveelheid, melding } from "../util.js";
import { receptStaat } from "./recept.js";
import { gekookt } from "./gekookt.js";

let wekker = null;      // lopende kookwekker {eind, minuten, id}
let schermSlot = null;  // Wake Lock: scherm niet laten uitgaan

async function schermAan() {
  try {
    schermSlot = await navigator.wakeLock?.request("screen");
  } catch { schermSlot = null; }
  return !!schermSlot;
}
function schermVrij() {
  schermSlot?.release().catch(() => {});
  schermSlot = null;
}
// Na terugkeren naar het tabblad vervalt het slot; opnieuw aanvragen zolang de kookstand open is.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && location.hash.endsWith("/koken")) schermAan();
});
window.addEventListener("hashchange", () => { if (!location.hash.endsWith("/koken")) schermVrij(); });

function piep() {
  try {
    const ctx = new AudioContext();
    [0, 0.4, 0.8].forEach((t) => {
      const o = ctx.createOscillator();
      o.frequency.value = 880;
      o.connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* geen geluid mogelijk */ }
}

// "20-30 minuten" → 30, "1-2 min" → 2, "10 min" → 10
function minutenIn(tekst) {
  const m = [...tekst.matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?\s*min/gi)];
  return m.length ? Math.max(...m.map((x) => Number(x[2] || x[1]))) : null;
}

export function koken(main, data, id) {
  const r = data.recepten[id];
  if (!r) {
    main.innerHTML = `<p class="leeg-tekst">Recept niet gevonden. <a href="#/">Terug</a></p>`;
    return;
  }
  const s = receptStaat(id, r);
  const factor = s.porties / (r.porties || 1);
  const optie = r.keuzes?.opties?.find((o) => o.id === s.keuze) || r.keuzes?.opties?.[0];
  const schermen = [{ klaarzetten: true }, ...r.stappen, { klaar: true }];
  let i = 0;

  const regelLijst = (lijst) => `<ul class="k-ingr">${lijst.map((x) =>
    `<li><span class="hv">${esc(hoeveelheid(x, factor))}</span> <span>${esc(x.naam || data.ingredienten[x.ingredient]?.naam || x.recept || "")}</span></li>`).join("")}</ul>`;

  function teken() {
    const sch = schermen[i];
    const stapNr = i;
    let inhoud;
    if (sch.klaarzetten) {
      inhoud = `<p class="k-label">Alles klaarzetten · ${r.porties ? `${s.porties} ${s.porties === 1 ? "portie" : "porties"}` : `${s.porties}×`}</p>
        ${regelLijst([...regels(r, s.keuze)].filter((x) => x.naam || x.ingredient || x.recept))}`;
    } else if (sch.klaar) {
      inhoud = `<p class="k-tekst">Klaar! Eet smakelijk.</p>
        <p><button class="knop primair groot" data-gekookt>Gekookt: in het logboek…</button></p>`;
    } else {
      const min = minutenIn(sch.instructie);
      const keuzeHier = optie && (sch.ingredienten || []).some((x) => /keuze/i.test(x.naam || ""));
      inhoud = `<p class="k-label">Stap ${stapNr} van ${r.stappen.length}</p>
        ${(sch.ingredienten || []).length ? regelLijst(sch.ingredienten.filter((x) => !/keuze/i.test(x.naam || ""))) : ""}
        ${keuzeHier ? `<p class="k-label">${esc(r.keuzes.titel || "Keuze")}: ${esc(optie.naam)}</p>${regelLijst(optie.ingredienten)}` : ""}
        <p class="k-tekst">${esc(sch.instructie)}</p>
        ${min ? `<p><button class="knop" data-wekker="${min}">⏱ Kookwekker ${min} min</button></p>` : ""}`;
    }
    main.innerHTML = `<div class="kookstand">
      <div class="k-kop">
        <a class="terug" href="#/recept/${esc(id)}">× Stoppen</a>
        <span class="k-titel">${esc(r.titel)}</span>
        <span class="k-wekker" aria-live="polite"></span>
      </div>
      <div class="k-voortgang"><span style="width:${(i / (schermen.length - 1)) * 100}%"></span></div>
      <div class="k-inhoud">${inhoud}</div>
      <div class="k-knoppen">
        <button class="knop groot" data-d="-1" ${i === 0 ? "disabled" : ""}>← Vorige</button>
        <button class="knop primair groot" data-d="1" ${i === schermen.length - 1 ? "disabled" : ""}>Volgende →</button>
      </div>
      <p class="hint k-scherm"></p>
    </div>`;
    toonWekker();
    main.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => ga(Number(b.dataset.d))));
    main.querySelector("[data-wekker]")?.addEventListener("click", (e) => startWekker(Number(e.target.dataset.wekker)));
    main.querySelector("[data-gekookt]")?.addEventListener("click", () => {
      const opMenu = kookbeurtOpMenu(data, id);
      gekookt({ data, recept: r, porties: s.porties, keuze: s.keuze, menuId: opMenu?.id,
        klaar: () => { location.hash = `#/recept/${id}`; } });
    });
    schermAan().then((ok) => {
      const el = main.querySelector(".k-scherm");
      if (el) el.textContent = ok ? "Het scherm blijft aan zolang de kookstand open is." : "";
    });
  }

  function ga(d) {
    const n = Math.min(schermen.length - 1, Math.max(0, i + d));
    if (n !== i) { i = n; teken(); }
  }

  function startWekker(minuten) {
    clearInterval(wekker?.id);
    wekker = { eind: Date.now() + minuten * 60000, minuten, id: setInterval(toonWekker, 1000) };
    toonWekker();
  }
  function toonWekker() {
    const el = main.querySelector(".k-wekker");
    if (!wekker) { if (el) el.textContent = ""; return; }
    const rest = Math.max(0, Math.round((wekker.eind - Date.now()) / 1000));
    if (el) {
      el.innerHTML = rest ? `⏱ ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")} <button class="mini" data-stopwekker aria-label="Kookwekker stoppen">×</button>` : "";
      el.querySelector("[data-stopwekker]")?.addEventListener("click", () => { clearInterval(wekker.id); wekker = null; toonWekker(); });
    }
    if (!rest) {
      clearInterval(wekker.id);
      wekker = null;
      piep();
      melding("De kookwekker is afgelopen");
    }
  }

  // Pijltjestoetsen en vegen.
  const toets = (e) => {
    if (!location.hash.endsWith("/koken")) return document.removeEventListener("keydown", toets);
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); ga(1); }
    if (e.key === "ArrowLeft") ga(-1);
  };
  document.addEventListener("keydown", toets);
  let startX = null;
  main.ontouchstart = (e) => { startX = e.touches[0].clientX; };
  main.ontouchend = (e) => {
    if (startX == null || !location.hash.endsWith("/koken")) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 60) ga(dx < 0 ? 1 : -1);
    startX = null;
  };
  window.addEventListener("hashchange", function weg() {
    main.ontouchstart = main.ontouchend = null;
    window.removeEventListener("hashchange", weg);
  });

  teken();
}
