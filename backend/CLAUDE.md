# CLAUDE.md — backend/

Firebase project for the WEDGE Litter Tracker (`litter-map-69921`).

## Structure

```
backend/
  firebase.json           # Firebase project config (points at rules, indexes, functions/)
  .firebaserc             # Project alias → project ID mapping
  firestore.rules         # Firestore security rules
  firestore.indexes.json  # Composite index definitions
  functions/
    index.js              # Cloud Functions (Node 24, firebase-functions v2)
    package.json
```

## Firestore data model

### `reports` collection

| Field       | Type        | Notes                                      |
|-------------|-------------|--------------------------------------------|
| `latitude`  | number      | Immutable after creation                   |
| `longitude` | number      | Immutable after creation                   |
| `timestamp` | timestamp   | When the litter was reported; updatable    |
| `cleanedAt` | timestamp \| null | `null` on creation; set once when cleaned |

Security rules enforce all of these constraints server-side. `cleanedAt` can only transition `null → timestamp`, never back.

**Active reports** are those where `cleanedAt == null`. The composite index on `(cleanedAt ASC, timestamp ASC)` supports snapshot queries filtering on `cleanedAt`.

## Cloud Functions

Both functions (v2 Firestore triggers) are stubs that log document ID and auth UID:

- `onReportCreated` — fires on `reports/{reportId}` create
- `onReportUpdated` — fires on `reports/{reportId}` update

These will be filled in later to implement statistics tracking in a separate firebase collection.

## Deploy commands

Run from `backend/`:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy   # deploy everything
```

Or from `functions/` for functions only:

```bash
npm run deploy
npm run logs      # tail Cloud Functions logs
```

## CI/CD

`.github/workflows/deploy-backend.yml` runs `firebase deploy` on every push to `main` that touches `backend/**`, and can be triggered manually from the Actions tab.

Authentication uses Workload Identity Federation (OIDC) — no service account key is stored anywhere. The job runs inside the `google-cloud` GitHub environment, which holds two repository variables: `WIF_PROVIDER` (the WIF provider resource name) and `FIREBASE_DEPLOYER_SA` (`firebase-deployer@litter-map-69921.iam.gserviceaccount.com`). See `backend/README.md` for the full GCloud resource architecture.
