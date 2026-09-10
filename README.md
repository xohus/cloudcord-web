# CloudCord Web — getcloudcord.com

Official open-source website and StoreCloud API for **CloudCord by Xohus**, a client-side Discord customization framework for iOS, iPadOS, Android, and Windows.

- Canonical website: https://getcloudcord.com/
- Client source: https://github.com/xohus/cloudcord
- Website source: https://github.com/xohus/cloudcord-web
- Security overview: https://getcloudcord.com/security

This project is unrelated to CloudCord.net, cloudcord.io, and the `github.com/cloudcord` organization, which describe a separate bot-hosting project. CloudCord by Xohus is not a bot host, Discord OAuth phishing page, credential stealer, remote-access tool, or cryptocurrency miner. It is independent software and is not affiliated with or endorsed by Discord Inc.

## StoreCloud deployment

StoreCloud requires Railway PostgreSQL via `DATABASE_URL`, a Discord OAuth application, and two independently generated secrets. Configure the OAuth redirect URL as:

`https://getcloudcord.com/v1/oauth/callback`

Copy the variable names from `.env.example`. Never commit their values. The service creates its PostgreSQL tables on startup, encrypts every synced value with AES-256-GCM, stores only hashes of device credentials, rate-limits the API, validates sync keys and checksums, and enforces a per-user storage quota.
