# Wedge Litter Map — Backend

Firebase project (`litter-map-69921`) providing Firestore storage and Cloud Functions for the WEDGE Litter Tracker.

## Firestore data model

### `reports` collection

| Field       | Type               | Notes                                   |
|-------------|--------------------|-----------------------------------------|
| `latitude`  | number             | Immutable after creation                |
| `longitude` | number             | Immutable after creation                |
| `timestamp` | timestamp          | When the litter was reported            |
| `cleanedAt` | timestamp \| null  | `null` until marked cleaned; write-once |

Active (uncleaned) reports have `cleanedAt == null`. A composite index on `(cleanedAt ASC, timestamp ASC)` supports snapshot queries that filter on this field.

## Deploying

### Manual deploy

Run from `backend/`:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy   # all of the above
```

### CI/CD — GitHub Actions

The workflow at `.github/workflows/deploy-backend.yml` runs automatically on every push to `main` that touches a file under `backend/`, and can also be triggered manually from the Actions tab. It authenticates to Google Cloud using **Workload Identity Federation** (OIDC) — no service account key or long-lived credential is stored anywhere.

#### Google Cloud resource architecture

The following resources were provisioned once to support keyless authentication from GitHub Actions. They live in GCP project `litter-map-69921` (project number `571285630878`).

##### Enabled APIs

| API | Purpose |
|-----|---------|
| `iam.googleapis.com` | IAM management |
| `iamcredentials.googleapis.com` | Service account impersonation |
| `sts.googleapis.com` | Security Token Service (exchanges OIDC tokens) |
| `cloudfunctions.googleapis.com` | Cloud Functions deploy |
| `cloudbuild.googleapis.com` | Required by Cloud Functions v2 for container builds |
| `artifactregistry.googleapis.com` | Required by Cloud Functions v2 for image storage |

##### Workload Identity Pool — `github-pool`

A Workload Identity Pool is a logical container for external identity providers. This pool holds the GitHub Actions OIDC provider. It is scoped to the GCP project, not to any specific repository — the repository restriction is enforced by the provider's attribute condition (see below).

##### Workload Identity Provider — `github-provider`

An OIDC provider inside `github-pool` configured to trust tokens issued by GitHub Actions:

| Setting | Value |
|---------|-------|
| Issuer URI | `https://token.actions.githubusercontent.com` |
| Attribute mapping | `google.subject = assertion.sub`, `attribute.repository = assertion.repository` |
| Attribute condition | `assertion.repository == 'thewedgempls/litter-map'` |

The attribute condition is the critical security constraint: it ensures that only workflows running inside this specific repository can exchange a GitHub OIDC token for GCP credentials. Without it, any GitHub Actions workflow on any public repository could potentially obtain credentials.

The OIDC token GitHub issues expires in ~10 minutes, so any credentials derived from it are also short-lived.

##### Service account — `firebase-deployer`

A dedicated service account (`firebase-deployer@litter-map-69921.iam.gserviceaccount.com`) was created exclusively for CI deployments. It holds only the roles needed to run `firebase deploy`:

| Role | Why it is needed |
|------|-----------------|
| `roles/firebase.admin` | Deploy Firestore rules and indexes |
| `roles/cloudfunctions.developer` | Deploy Cloud Functions |
| `roles/iam.serviceAccountUser` | Cloud Functions v2 must act as the Compute/App Engine runtime service account during deploy |
| `roles/artifactregistry.writer` | Cloud Functions v2 pushes container images to Artifact Registry |

##### WIF → service account binding

The Workload Identity Pool principal for this repository is granted `roles/iam.workloadIdentityUser` on the service account:

```
member: principalSet://iam.googleapis.com/projects/571285630878/locations/global/
        workloadIdentityPools/github-pool/attribute.repository/thewedgempls/litter-map
role:   roles/iam.workloadIdentityUser
```

This is the binding that allows the GitHub Actions runner to impersonate `firebase-deployer` — nothing broader. The runner requests a short-lived access token by presenting its OIDC token to the Security Token Service, which validates the token against the provider's issuer and attribute condition before granting impersonation.

#### GitHub environment — `google-cloud`

The deploy job runs inside the `google-cloud` GitHub environment (configured at Settings → Environments). This environment holds two repository variables:

| Variable | Value |
|----------|-------|
| `WIF_PROVIDER` | Full resource name of the Workload Identity Provider |
| `FIREBASE_DEPLOYER_SA` | `firebase-deployer@litter-map-69921.iam.gserviceaccount.com` |

Neither value is a secret — they are resource identifiers, not credentials. Storing them in the environment (rather than at repo level) scopes them to deployment jobs and allows environment-level approval gates to be added in the future if needed.
