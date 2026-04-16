# Fixture redaction rules

Live fixtures captured from the sitefire Bing Webmaster API account are sanitized before commit:

- **Emails** in `GetSiteRoles` responses: replaced with `redacted@example.com`
- **DnsVerificationCode** and **AuthenticationCode** fields: replaced with `REDACTED`
- **Query text** that could leak customer intent: replaced with generic terms
- **API keys**: never captured in fixtures (passed via env, not in response bodies)

Synthetic fixtures in `synthetic/` are hand-crafted and contain no real data.
