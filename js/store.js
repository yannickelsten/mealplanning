// Alle toegang tot de data loopt via deze module. Op de laptop praat hij met de lokale
// server (store-lokaal.js), op de telefoon rechtstreeks met de privé-repository op GitHub
// (store-github.js). De rest van de app merkt het verschil niet.
import * as lokaal from "./store-lokaal.js";
import * as github from "./store-github.js";

const S = ["127.0.0.1", "localhost"].includes(location.hostname) ? lokaal : github;

export const soort = S.soort;            // "lokaal" of "github"
export const alleenLezen = S.alleenLezen; // recepten bewerken kan alleen op de laptop
export const kijkElke = S.kijkElke;       // ms tussen twee keer kijken of er iets veranderd is
export const laad = (...a) => S.laad(...a);
export const wijzig = (...a) => S.wijzig(...a);
export const dataVersie = (...a) => S.dataVersie(...a);
export const bewaarIngredient = (...a) => S.bewaarIngredient(...a);
export const bewaarRecept = (...a) => S.bewaarRecept(...a);
export const verwijderRecept = (...a) => S.verwijderRecept(...a);
export const koppeling = (...a) => S.koppeling(...a);
export const koppel = (...a) => S.koppel(...a);
export const ontkoppel = (...a) => S.ontkoppel(...a);
export const taak = (...a) => S.taak(...a); // prijzen/aanbiedingen ophalen (alleen laptop, op verzoek)
// Moment van de laatste eigen wijziging (ms), zie main.js.
export const laatsteEigenWijziging = () => S.laatsteEigenWijziging;
