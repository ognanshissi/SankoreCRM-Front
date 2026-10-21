# Application d'administration Angular 22 en SSR (`outputMode: "server"` dans
# apps/admin/project.json) : l'image fait tourner le serveur Express généré, elle ne sert
# pas des fichiers statiques. Le `Dockerfile` à la racine fait la même chose pour `crm` ;
# les deux sont séparés parce que chacun ne construit qu'un seul projet nx.
#
#   docker build -f admin.Dockerfile -t sankore-admin .
#   docker run --rm -p 4001:4000 -e NG_ALLOWED_HOSTS=admin.example.com sankore-admin
#
# Le contexte de build est la racine du monorepo (et non apps/admin) : le build nx a besoin
# du lockfile, de nx.json, de tsconfig.base.json et des bibliothèques de packages/.

# ── Dépendances ───────────────────────────────────────────────────────────────
# Étape séparée pour que la couche npm soit réutilisée tant que le lockfile ne change pas.
# Pas de `--omit=dev` : nx et @angular/build sont en devDependencies.
#
# Pas de `--legacy-peer-deps` : voir le commentaire du `Dockerfile` racine. Le remettre
# ferait accepter une résolution que npm juge incorrecte, et masquerait ici un conflit qui
# casserait quand même la CI, qui exécute `npm ci` sans drapeau.
FROM node:24-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /workspace

# Le daemon nx n'a pas de sens dans un conteneur jetable et fait échouer le build sur
# certains runners en le laissant orphelin.
ENV NX_DAEMON=false

# Un seul worker Angular au lieu d'un par cœur vu par le conteneur (souvent tous ceux de
# l'hôte). Mesuré sur `admin:build:production` dans un conteneur à mémoire bornée : sans ce
# réglage il faut ~2 Go, avec lui 1,5 Go suffisent. En dessous, le noyau tue le processus juste
# après « ❯ Building... », sans le moindre message — c'est ce qu'on voyait sur Dokploy, où le
# build partage la RAM du serveur avec les conteneurs en service.
ENV NG_BUILD_MAX_WORKERS=1

# Ramasse-miettes d'esbuild (Go) et de Node plus agressifs : voir le `Dockerfile` de `crm`
# pour les mesures. Mêmes plafonds ici, `admin` restant en dessous.
ENV GOMEMLIMIT=1200MiB
ENV NODE_OPTIONS=--max-old-space-size=1280

COPY --from=deps /workspace/node_modules ./node_modules
COPY . .

# Configuration `production` et non `development` : c'est elle qui minifie, qui empreinte
# les noms de fichiers et qui applique les budgets. `@angular/build:application` a
# `dependsOn: ["^build"]` (targetDefaults dans nx.json), donc nx construit d'abord les
# bibliothèques dont `admin` dépend — @talisoft/ui le jour où l'app l'importera.
RUN npx nx run admin:build:production

# ── Runtime ───────────────────────────────────────────────────────────────────
# Le bundle serveur produit par @angular/build inline ses dépendances (express compris) et
# n'importe plus que des modules natifs Node : l'image finale n'a besoin d'aucun
# node_modules. Vérifié sur la sortie du build — seuls `node:module`, `path`, `process` et
# `url` restent externes.
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Angular 22 valide l'en-tête Host des requêtes servies par le handler SSR (protection
# SSRF) et répond 400 pour tout hôte hors liste. Sans cette variable l'application ne sert
# rien — y compris ici, où toutes les routes sont en `RenderMode.Prerender` : la validation
# s'applique au handler, pas au rendu, donc elle rejette aussi une page déjà prérendue.
# Vérifié : sans la variable, `/` répond 400 même pour `Host: localhost`.
#
# La valeur par défaut rend le conteneur testable en local ; en déploiement, passer le ou
# les domaines publics séparés par des virgules (`-e NG_ALLOWED_HOSTS=admin.example.com`).
ENV NG_ALLOWED_HOSTS=localhost

# Pas de NG_API_URL ici, contrairement à l'image `crm`, et c'est voulu : l'admin ne lit pas de
# `/config.json`. L'URL de l'API d'administration est COMPILÉE depuis
# apps/admin/src/environments/environment.prod.ts — changer de domaine d'API veut dire modifier
# ce fichier et reconstruire l'image. Déclarer la variable laisserait croire qu'elle atteint le
# navigateur alors que personne ne la lirait. (`apps/admin/dev/config.json` existe, mais pour
# `nx serve admin` seulement : il n'est copié que par la configuration `development`, et le code
# ne le lit que si `environment.production` est faux.)

# Derrière un reverse proxy qui termine TLS, décommenter pour que le rendu voie le schéma et
# l'hôte d'origine : ENV NG_TRUST_PROXY_HEADERS=x-forwarded-proto,x-forwarded-host

# dist/apps/admin contient `server/` (le serveur SSR), `browser/` (les assets, que
# server.mjs résout en `../browser`) et prerendered-routes.json.
COPY --from=build /workspace/dist/apps/admin ./

USER node
EXPOSE 4000

# La sonde tape un fichier statique et non `/` : express.static est monté avant le handler
# Angular, donc la réponse ne dépend pas de NG_ALLOWED_HOSTS (vérifié : `/favicon.ico`
# répond 200 même avec un Host refusé) et ne déclenche aucun rendu à chaque intervalle.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||4000,path:'/favicon.ico'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
