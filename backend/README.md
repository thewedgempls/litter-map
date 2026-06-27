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

Run from `backend/`:

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only functions
firebase deploy   # all of the above
```
