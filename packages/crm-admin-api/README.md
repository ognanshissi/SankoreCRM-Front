# crm-admin-api

Client HTTP **généré** de l'API Sankore.Admin (registre des tenants et connexion des
administrateurs plateforme). `src/lib` ne s'édite jamais à la main.

Régénérer :

```bash
# 1. dans SankoreCRM — émet le contrat sans base de données (chemin ABSOLU)
dotnet run --project src/Bootstrapper/Sankore.Admin -- \
  --emit-openapi "$(cd .. && pwd)/SankoreFront/swaggers/sankore-crm-admin-api-swagger.json"

# 2. dans SankoreFront
npm run openapi-generator-admin
```

Importé uniquement par l'app `admin` (`@sankore/crm-admin-api`). Ne pas l'importer à côté de
`@sankore/crm-api` : les deux exportent un `BASE_PATH` et une `Configuration` homonymes.
