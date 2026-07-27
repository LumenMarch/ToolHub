# 1. ToolHub Backend

## 1.1. Authentication Cookie

Browser sessions use the `toolhub_session` HttpOnly cookie with
`SameSite=Strict`. Local HTTP development keeps `AUTH_COOKIE_SECURE=false`.
Production deployments served over HTTPS must set:

```env
AUTH_COOKIE_SECURE=true
```

The OAuth2 Bearer Token endpoint remains available for non-browser API
clients.
