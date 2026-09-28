# Image statique : nginx sert le lot navigateur de l'application Angular.
#
# À la différence du `Dockerfile` à la racine, qui fait tourner le serveur SSR Node,
# cette image **n'exécute aucun rendu serveur** : nginx ne sait pas exécuter le bundle
# produit par `@angular/build`. Seul `dist/apps/crm/browser` est embarqué, et
# `dist/apps/crm/server` est écarté.
#
#   docker compose up --build
#   http://localhost:8080

# ── Build ─────────────────────────────────────────────────────────────────────
# `--legacy-peer-deps` : ngx-quill@30 déclare un peer `@angular/core@^21` alors que le
# workspace est en Angular 22. C'est la résolution avec laquelle le lockfile a été produit ;
# sans le drapeau, `npm ci` échoue en ERESOLVE. À retirer dès que ngx-quill suit.
FROM node:24-alpine AS build
WORKDIR /workspace

ENV NX_DAEMON=false

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --legacy-peer-deps

COPY . .

# Configuration `production` et non `development` : c'est elle qui minifie, qui empreinte
# les noms de fichiers (ce dont dépendent les règles de cache de nginx) et qui substitue
# `environment.prod.ts`.
RUN npx nx run crm:build:production

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# La configuration par défaut de l'image écouterait sur `/` avec un `index.html` absent
# de notre lot : on la remplace entièrement.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf

COPY --from=build /workspace/dist/apps/crm/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# `daemon off` : nginx doit rester au premier plan pour que Docker suive son cycle de vie.
CMD ["nginx", "-g", "daemon off;"]
