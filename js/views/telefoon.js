// Pagina "Telefoon": koppelen met GitHub, zodat de app ook op de telefoon werkt.
// Op de laptop: sleutel van de laptop invullen en de volgende stappen. Op de telefoon: de
// koppeling van dit toestel (en het scherm waarmee je de eerste keer koppelt).
import { koppel, koppeling, ontkoppel, soort } from "../store.js";
import { esc, melding } from "../util.js";

const NIEUWE_SLEUTEL = "https://github.com/settings/personal-access-tokens/new";
const SLEUTELS = "https://github.com/settings/personal-access-tokens";

const sleutelUitleg = (naam, repos) => `
  <ol class="stappen-uitleg">
    <li>Open <a href="${NIEUWE_SLEUTEL}" target="_blank" rel="noopener">github.com: nieuwe sleutel</a> (log in als dat gevraagd wordt).</li>
    <li><b>Token name</b>: <code>${naam}</code>. <b>Expiration</b>: <i>No expiration</i>.</li>
    <li><b>Repository access</b>: <i>Only select repositories</i>, kies ${repos}.</li>
    <li><b>Permissions</b> → <b>Repository permissions</b> → <b>Contents</b>: <i>Read and write</i>. Verder niets.</li>
    <li>Klik <b>Generate token</b> en kopieer de tekst die met <code>github_pat_</code> begint.</li>
  </ol>`;

function formulier(knop) {
  return `<form class="formulier koppel" data-koppel>
    <label class="veld"><span>GitHub-gebruikersnaam</span>
      <input name="gebruiker" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
    <label class="veld"><span>Sleutel</span>
      <input name="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required
        placeholder="github_pat_…"></label>
    <p class="fout" data-fout hidden></p>
    <div class="knoppen"><button class="knop primair">${knop}</button></div>
  </form>`;
}

function bijVersturen(main, klaar) {
  const form = main.querySelector("[data-koppel]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form), knop = form.querySelector("button"), fout = form.querySelector("[data-fout]");
    knop.disabled = true;
    knop.textContent = "Bezig met controleren…";
    fout.hidden = true;
    try {
      await koppel(fd.get("gebruiker"), fd.get("token"));
      klaar();
    } catch (err) {
      fout.textContent = err.message;
      fout.hidden = false;
      knop.disabled = false;
      knop.textContent = "Opnieuw proberen";
    }
  });
}

// Telefoon, nog niet gekoppeld (of de sleutel werkt niet meer).
export function koppelScherm(main, reden) {
  main.innerHTML = `
    <h1 class="paginatitel">Welkom</h1>
    <p>Koppel deze telefoon aan je gegevens. Dat hoeft maar één keer; daarna opent de app meteen.</p>
    ${reden && reden !== "Nog niet gekoppeld." ? `<p class="waarschuwing los">${esc(reden)}</p>` : ""}
    ${formulier("Verbinden")}
    <details class="uitleg"><summary>Hoe maak ik een sleutel voor de telefoon?</summary>
      ${sleutelUitleg("Mealplanning telefoon", "<b>alleen</b> <code>mealplanning-data</code>")}
    </details>
    <p class="hint">De sleutel blijft op deze telefoon. Telefoon kwijt? Verwijder de sleutel
      <i>Mealplanning telefoon</i> op <a href="${SLEUTELS}" target="_blank" rel="noopener">github.com</a>.</p>`;
  bijVersturen(main, () => {
    melding("Gekoppeld");
    location.hash = "#/boodschappen";
    window.dispatchEvent(new Event("tekenen"));
  });
}

export async function telefoon(main) {
  main.innerHTML = `<h1 class="paginatitel">Telefoon</h1><p class="hint">Even kijken…</p>`;
  let k;
  try {
    k = await koppeling();
  } catch (err) {
    main.innerHTML = `<p class="waarschuwing los">Kan de koppeling niet lezen: ${esc(err.message)}</p>`;
    return;
  }
  if (soort === "github") return opTelefoon(main, k);
  if (!k.gebruiker) return nietGekoppeld(main);
  gekoppeld(main, k);
}

function nietGekoppeld(main) {
  main.innerHTML = `
    <h1 class="paginatitel">Telefoon</h1>
    <p>Om de app ook op je telefoon te gebruiken, zet de laptop je gegevens in je privé-repository
      <code>mealplanning-data</code> op GitHub en houdt hem daarna vanzelf bij (zolang de app open is).</p>
    <h2 class="kop2">Stap 1: de laptop koppelen</h2>
    ${sleutelUitleg("Mealplanning laptop", "<code>mealplanning-data</code> <b>en</b> <code>mealplanning</code>")}
    <p>Vul hieronder je gebruikersnaam in en plak de sleutel. Hij wordt bewaard op deze laptop,
      buiten OneDrive, en verlaat de laptop alleen richting GitHub.</p>
    ${formulier("Koppelen")}`;
  bijVersturen(main, () => {
    melding("Gekoppeld, de gegevens gaan nu naar GitHub");
    setTimeout(() => telefoon(main), 4000);
    telefoon(main);
  });
}

function gekoppeld(main, k) {
  const u = esc(k.gebruiker);
  const adres = `https://${u.toLowerCase()}.github.io/${esc(k.app_repo)}/`;
  const status = k.fout ? `<p class="waarschuwing los">Synchroniseren lukt niet: ${esc(k.fout)}</p>`
    : k.laatste ? `<p class="goed">✓ Gekoppeld als <b>${u}</b>. Laatst bijgewerkt
        ${Math.max(0, Math.round(Date.now() / 1000 - k.laatste))} seconden geleden.</p>`
    : `<p class="hint">Gekoppeld als <b>${u}</b>. Eerste keer bijwerken… (ververs deze pagina over een halve minuut)</p>`;
  main.innerHTML = `
    <h1 class="paginatitel">Telefoon</h1>
    ${status}
    <p>Zolang de app op de laptop open is, worden wijzigingen elke 15 seconden uitgewisseld met
      <a href="https://github.com/${u}/${esc(k.repo)}" target="_blank" rel="noopener">${esc(k.repo)}</a>.</p>

    <h2 class="kop2">Stap 2: de website aanzetten <small>(één keer)</small></h2>
    <ol class="stappen-uitleg">
      <li>Open <a href="https://github.com/${u}/${esc(k.app_repo)}/settings/pages" target="_blank" rel="noopener">de Pages-instellingen van <code>${esc(k.app_repo)}</code></a>.</li>
      <li>Bij <b>Source</b>: <i>Deploy from a branch</i>. Bij <b>Branch</b>: <i>main</i> en <i>/ (root)</i>, dan <b>Save</b>.</li>
      <li>Wacht een paar minuten. Bovenaan die pagina verschijnt dan: <i>Your site is live at…</i></li>
    </ol>

    <h2 class="kop2">Stap 3: op de telefoon <small>(één keer)</small></h2>
    <ol class="stappen-uitleg">
      <li>Maak op de telefoon een tweede sleutel, net als bij stap 1 maar met naam
        <code>Mealplanning telefoon</code> en <b>alleen</b> <code>mealplanning-data</code>
        (<a href="${NIEUWE_SLEUTEL}" target="_blank" rel="noopener">nieuwe sleutel</a>).</li>
      <li>Open op de telefoon <b class="adres">${adres}</b>, vul je gebruikersnaam in en plak de sleutel.</li>
      <li>Zet de app op je beginscherm. iPhone (Safari): deelknop → <i>Zet op beginscherm</i>.
        Android (Chrome): menu ⋮ → <i>Toevoegen aan startscherm</i>.</li>
    </ol>

    <h2 class="kop2">Telefoon kwijt?</h2>
    <p>Verwijder de sleutel <i>Mealplanning telefoon</i> op
      <a href="${SLEUTELS}" target="_blank" rel="noopener">github.com</a>. De laptop werkt gewoon door.</p>
    <div class="knoppen"><button class="knop" data-ontkoppel>Laptop ontkoppelen</button></div>`;
  main.querySelector("[data-ontkoppel]").addEventListener("click", async () => {
    if (!confirm("De laptop stopt met bijwerken van GitHub. De telefoon ziet dan geen nieuwe gegevens meer. Doorgaan?")) return;
    await ontkoppel();
    melding("Ontkoppeld");
    telefoon(main);
  });
}

function opTelefoon(main, k) {
  main.innerHTML = `
    <h1 class="paginatitel">Koppeling</h1>
    <p class="goed">✓ Gekoppeld als <b>${esc(k.gebruiker)}</b>.</p>
    ${k.wachtrij ? `<p class="waarschuwing los">${k.wachtrij} wijziging(en) wachten nog op verbinding.</p>` : ""}
    <p>Wijzigingen hier komen op de laptop binnen zodra de app daar open is.
      Recepten en ingrediënten bewerken kan op de laptop.</p>
    <div class="knoppen"><button class="knop" data-ontkoppel>Verbinding verbreken</button></div>
    <p class="hint">Haalt de sleutel en de bewaarde gegevens van deze telefoon. Je gegevens op GitHub en
      de laptop blijven gewoon bestaan.</p>`;
  main.querySelector("[data-ontkoppel]").addEventListener("click", async () => {
    if (k.wachtrij && !confirm("Er wachten nog wijzigingen op verbinding; die gaan verloren. Doorgaan?")) return;
    await ontkoppel();
    location.hash = "#/";
    window.dispatchEvent(new Event("tekenen"));
  });
}
