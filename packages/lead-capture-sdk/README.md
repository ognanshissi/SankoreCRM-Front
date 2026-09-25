# @sankore/lead-capture-sdk — `forms.js`

SDK navigateur qui transmet au CRM les soumissions d'un formulaire existant.
Couvre **FE-13** (rattachement, ping, UTM, envoi), **FE-14** (captcha,
messages) et **FE-15** (formulaire hébergé rendu en Shadow DOM).

## Contraintes tenues

| Exigence (FE-13 AC7) | État |
|---|---|
| Aucune dépendance | ✅ `src/` n'importe que des API navigateur |
| < 8 Ko compressé | ✅ **3,28 Ko gzip** (budget vérifié au build, échec si dépassé) |
| Navigateurs des 2 dernières années | ✅ cible `chrome109, firefox115, safari16, edge109` |
| Versions immuables + empreinte SRI | ✅ `forms.js.meta.json` publié à côté du bundle |

## Build

```
nx build lead-capture-sdk           # typecheck puis bundle
nx build lead-capture-sdk:watch
```

Sortie dans `dist/packages/lead-capture-sdk/` : `forms.js`, sa source map et
`forms.js.meta.json` (version, tailles, `sri`). **L'empreinte SRI de ce fichier
est celle que le back doit servir dans `SnippetResult.sriHash`.** Une version
publiée ne doit plus jamais changer de contenu : republier, c'est émettre une
nouvelle version.

Le bundle est un **IIFE** et non un module ES : il est chargé par une balise
`<script>` ordinaire sur des sites tiers, dont beaucoup ne servent pas de
modules. C'est la raison pour laquelle ce projet n'utilise pas l'exécuteur
`@nx/esbuild` (qui n'émet que de l'ESM/CJS) mais `tools/build.mjs`.

## Contrat d'intégration — attributs `data-*`

Toute la configuration passe par la balise `<script>`, **générée côté back**
(`GET /api/leads/sources/{id}/snippet`). Le SDK ne fait aucun appel de
configuration au démarrage : il reste fonctionnel même si le CRM est
momentanément indisponible.

| Attribut | Requis | Défaut | Rôle |
|---|---|---|---|
| `data-sankore-key` | ✅ | — | Clé publique de la source |
| `data-sankore-form` | ✅ | — | Sélecteur CSS du formulaire |
| `data-sankore-endpoint` | | origine du `src` | Hôte d'ingestion |
| `data-sankore-consent-field` | | — | Attribut `name` de la case de consentement |
| `data-sankore-consent-version` | | — | Version du texte de consentement |
| `data-sankore-fields` | | tout le formulaire | Noms de champs à transmettre, séparés par des virgules |
| `data-sankore-honeypot` | | `true` | Champ piège |
| `data-sankore-min-fill` | | `3` | Délai minimal de saisie, en secondes |
| `data-sankore-captcha` | | `None` | `None` / `Turnstile` / `HCaptcha` / `RecaptchaV3` |
| `data-sankore-captcha-key` | | — | Clé publique du captcha |
| `data-sankore-prevent-default` | | `true` | `false` : le formulaire garde son comportement d'origine |
| `data-sankore-success` | | message FR | Message de confirmation |
| `data-sankore-redirect` | | — | URL de redirection après succès |
| `data-sankore-render` | | `false` | `true` : le SDK **rend** le formulaire défini dans le CRM (FE-15) |

Exemple :

```html
<script src="https://ingest.sankore-crm.com/sdk/v1.0.0/forms.js"
        integrity="sha384-…" crossorigin="anonymous"
        data-sankore-key="pk_live_…"
        data-sankore-form="#contact-form"
        data-sankore-consent-field="consentement"
        data-sankore-consent-version="v2"
        data-sankore-min-fill="3"></script>
```

> ⚠️ **À aligner avec le back.** Ces noms d'attributs sont la convention posée
> par ce SDK ; le générateur de snippet doit produire exactement ces clés.
> C'est le seul point d'accord nécessaire entre les deux côtés.

## Endpoints consommés

| Appel | Quand |
|---|---|
| `POST /api/ingest/web/{publicKey}/ping` | Une fois par session et par source |
| `POST /api/ingest/web/{publicKey}` | À chaque soumission valide |
| `GET /api/ingest/web/{publicKey}/form` | Au chargement, si `data-sankore-render="true"` |

Le corps de l'envoi :

```jsonc
{
  "fields":  { "nom": "…", "telephone": "…" },  // champs bruts, non transformés
  "utm":     { "utm_source": "…" },             // ceux de la PREMIÈRE page de la visite
  "page":     "https://…",
  "referrer": "https://…",
  "consentGiven": true,
  "consentVersion": "v2",
  "captchaToken": "…",
  "submittedAt": "2026-09-25T…Z"
}
```

## Comportements notables

- **Garde-fous silencieux.** Honeypot rempli, saisie trop rapide ou consentement
  absent : la soumission n'est pas transmise et **rien n'est affiché** — un robot
  ne doit pas apprendre ce qui l'a trahi. Le formulaire garde son comportement.
- **Un seul réessai.** Erreur réseau ou 5xx → une seconde tentative après 800 ms,
  puis abandon. Un 4xx autre que 422 n'est jamais rejoué.
- **Aucune exception ne remonte.** Tout est encadré, y compris les accès à
  `sessionStorage` (navigation privée, cookies bloqués) et l'initialisation.
- **Envoi parallèle.** Avec `prevent-default="false"`, `fetch(keepalive)` fait
  survivre la requête à la navigation déclenchée par la soumission d'origine.
- **Captcha à la demande.** Le script du fournisseur n'est téléchargé qu'au
  premier `focus` dans le formulaire. S'il ne répond pas, la soumission part
  sans jeton : c'est au serveur de trancher, pas au SDK de bloquer le visiteur.
- **Accessibilité.** Les messages sont rendus dans une région
  `role="status" aria-live="polite"`, et le focus est déplacé sur la
  confirmation quand le formulaire est masqué.
- **Aucun style injecté.** Le SDK ne repeint jamais le site hôte.

## Formulaire hébergé (FE-15)

Avec `data-sankore-render="true"`, le SDK récupère la définition publique du
formulaire et la rend lui-même, sans qu'aucun formulaire n'existe sur la page.

```html
<script src="https://ingest.sankore-crm.com/sdk/v1.0.0/forms.js"
        data-sankore-key="pk_live_…"
        data-sankore-render="true"
        data-sankore-form="#zone-formulaire"></script>
```

`data-sankore-form` désigne alors le **conteneur** où insérer le formulaire ;
sans lui, le formulaire est inséré juste après la balise `<script>`.

Le rendu est un Web Component `<sankore-form>` à Shadow DOM : les styles sont
isolés **dans les deux sens** — le site ne peut pas casser le formulaire, et le
formulaire ne repeint pas le site. La définition vient de
`GET /api/ingest/web/{publicKey}/form` : **modifier les champs dans le CRM suffit**,
le script installé sur le site ne change pas.

### Thème

Quatre variables CSS, surchargeables par le site hôte sur l'élément
`sankore-form` :

```css
sankore-form {
  --sankore-accent: #0f766e;
  --sankore-font: "Inter", sans-serif;
  --sankore-radius: 10px;
  --sankore-border: #94a3b8;
}
```

`accentColor` et `fontFamily` de la définition CRM alimentent les deux
premières ; une règle du site les écrase.

### Accessibilité (WCAG 2.1 AA)

- Chaque champ porte un `<label for>` réel — jamais un simple placeholder.
- Le focus reste visible : `:focus-visible` avec un contour de 3 px, jamais supprimé.
- La case de consentement est `required` et son texte est cliquable.
- Les messages sont rendus dans une région `role="status" aria-live="polite"` ;
  le focus s'y déplace quand le formulaire est remplacé par la confirmation.
- `aria-busy` est posé sur le formulaire pendant l'envoi.
- Le bouton passe pleine largeur sous 420 px.

> Ces points sont couverts par `src/hosted-form.spec.ts`. Un audit manuel au
> lecteur d'écran reste nécessaire avant de déclarer la conformité : les tests
> vérifient la structure, pas l'expérience réelle.
