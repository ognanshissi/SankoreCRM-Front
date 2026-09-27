# Application Angular 22 en SSR (`outputMode: "server"` dans apps/crm/project.json) :
# l'image doit faire tourner le serveur Express généré, pas servir des fichiers statiques.
#
#   docker build -t sankore-crm .
#   docker run --rm -p 4000:4000 -e NG_ALLOWED_HOSTS=crm.example.com sankore-crm

# ── Dépendances ───────────────────────────────────────────────────────────────
# Étape séparée pour que la couche npm soit réutilisée tant que le lockfile ne
# change pas. Pas de `--omit=dev` : nx et @angular/build sont en devDependencies.
#
# `--legacy-peer-deps` : ngx-quill@30 déclare un peer `@angular/core@^21` alors que
# le workspace est en Angular 22. C'est la résolution avec laquelle le lockfile a été
# produit ; sans le drapeau, `npm ci` échoue en ERESOLVE. À retirer dès que ngx-quill
# publie une version compatible Angular 22.
FROM node:24-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /workspace

# Le daemon nx n'a pas de sens dans un conteneur jetable et fait échouer le build
# sur certains runners en le laissant orphelin.
ENV NX_DAEMON=false

COPY --from=deps /workspace/node_modules ./node_modules
COPY . .

# `crm:build:production` dépend de `ui:build` (targetDefaults dans nx.json) : nx
# construit le design system @talisoft/ui avant l'application.
RUN npx nx run crm:build:production

# ── Runtime ───────────────────────────────────────────────────────────────────
# Le bundle serveur produit par @angular/build inline ses dépendances (express
# compris) et n'importe plus que des modules natifs Node : l'image finale n'a
# donc besoin d'aucun node_modules.
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Angular 22 valide l'en-tête Host des requêtes rendues côté serveur (protection SSRF) et
# répond 400 pour tout hôte hors liste : sans cette variable, l'image ne sert rien. La valeur
# par défaut rend le conteneur testable en local ; en déploiement, passer le ou les domaines
# publics séparés par des virgules (`-e NG_ALLOWED_HOSTS=crm.example.com`).
ENV NG_ALLOWED_HOSTS=localhost

# Derrière un reverse proxy qui termine TLS, décommenter pour que le rendu voie le schéma et
# l'hôte d'origine : ENV NG_TRUST_PROXY_HEADERS=x-forwarded-proto,x-forwarded-host

# dist/apps/crm contient `server/` (le serveur SSR), `browser/` (les assets, que
# server.mjs résout en `../browser`) et prerendered-routes.json.
COPY --from=build /workspace/dist/apps/crm ./

USER node
EXPOSE 4000

# La sonde tape un fichier statique et non `/` : express.static est monté avant le handler
# Angular, donc la réponse ne dépend pas de NG_ALLOWED_HOSTS et ne déclenche pas un rendu SSR
# complet à chaque intervalle.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||4000,path:'/favicon.ico'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
