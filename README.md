# CloudCord Web — getcloudcord.com

Official proprietary website and StoreCloud API for **CloudCord by Xohus**, a client-side Discord customization framework for iOS, iPadOS, Android, and Windows.

- Canonical website: https://getcloudcord.com/
- Client source: https://github.com/xohus/cloudcord
- Security overview: https://getcloudcord.com/security

The CloudCord client and website are proprietary, not open source. Authorized client source may be inspected through SourceVault under the CloudCord Proprietary Source License; viewing source does not grant permission to fork, redistribute, or create derivatives.

This project is unrelated to CloudCord.net, cloudcord.io, and the `github.com/cloudcord` organization, which describe a separate bot-hosting project. CloudCord by Xohus is not a bot host, Discord OAuth phishing page, credential stealer, remote-access tool, or cryptocurrency miner. It is independent software and is not affiliated with or endorsed by Discord Inc.

## StoreCloud deployment

StoreCloud requires Railway PostgreSQL via `DATABASE_URL`, a Discord OAuth application, and two independently generated secrets. Configure the OAuth redirect URL as:

`https://getcloudcord.com/v1/oauth/callback`

Copy the variable names from `.env.example`. Never commit their values. The service creates its PostgreSQL tables on startup, encrypts every synced value with AES-256-GCM, stores only hashes of device credentials, rate-limits the API, validates sync keys and checksums, and enforces a per-user storage quota.

## laptop configuration

Private settings load automatically from `%LOCALAPPDATA%/CloudCord/web/settings.json`
on Windows, or `$HOME/.config/CloudCord/web/settings.json` elsewhere. Override
the location with `CLOUDCORD_SETTINGS_FILE`. Environment variables take priority.
Never put this file in the public directory or commit its contents.

With `CLOUDCORD_LOCAL_PROFILES=true` and no `DATABASE_URL`, Fake Profile sync
uses a lightweight SQLite database outside the repository. It preserves hashed
edit-token checks, revision checks, and independent read/write limits. This is
profile-only storage, not StoreCloud account sync or staff-application storage.
Back up the database with SQLite's backup tools; containers must mount a persistent
directory and set `CLOUDCORD_PROFILE_DB_FILE`. Node 22.13+ is required.
The shared API limit is 600 requests per minute; profiles use their separate
3000-read/240-write quotas. Admin login protection stays enabled. On the laptop,
Cloudflare's visitor IP is accepted only through the local tunnel connection,
so unrelated visitors do not share the connector's request quota.
