# CloudCord Web

Official CloudCord website and StoreCloud API.

## StoreCloud deployment

StoreCloud requires Railway PostgreSQL via `DATABASE_URL`, a Discord OAuth application, and two independently generated secrets. Configure the OAuth redirect URL as:

`https://cloudcord.xohus.lol/v1/oauth/callback`

Copy the variable names from `.env.example`. Never commit their values. The service creates its PostgreSQL tables on startup, encrypts every synced value with AES-256-GCM, stores only hashes of device credentials, rate-limits the API, validates sync keys and checksums, and enforces a per-user storage quota.
