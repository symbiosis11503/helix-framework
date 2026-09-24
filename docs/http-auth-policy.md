# HTTP Authentication and Bootstrap

Helix Lite now applies a centralized HTTP auth boundary for `/api/*` routes.

## Bootstrap

1. Start Helix with an admin bootstrap secret:

   ```bash
   ADMIN_TOKEN=your-secret-token helix start
   ```

2. Save the same secret for local CLI use:

   ```bash
   helix login --provider admin --api-key your-secret-token
   ```

3. Use that authenticated session to create scoped API keys from `POST /api/auth/keys`.

Health endpoints (`GET /api/health`, `GET /api/readiness`) stay public. Verified messaging-provider callbacks keep their existing public webhook entry points. Admin bootstrap now always requires a real token; private IP addresses are not treated as admin credentials.

## Role matrix

| Route class | Minimum role |
| --- | --- |
| Health/readiness | Public |
| Read-only API (`GET /api/...`) | `viewer` |
| Mutating API (`POST`/`DELETE /api/...`) | `operator` |
| Key management, 2FA management, OAuth management, MCP management, trace admin routes | `admin` |

## Agent/session scoping

- Authenticated caller scope comes from the validated key, never from `role_id`, `user_id`, or `agent_id` request fields.
- Scoped keys may only access their bound agent and that agent's sessions.
- Tool capability checks use the target agent's stored capability role, not caller-supplied body fields.
- Missing or unknown capability bindings deny access.

## Dangerous-operation safety boundary

Tool execution, file mutation, and MCP operations require the built-in command-safety and injection-defense hooks to be available. If safety initialization fails or those hooks are removed, dangerous endpoints return `503` instead of failing open.

## Upgrade notes

- Existing automation that called protected routes anonymously must now send a bearer token in the `Authorization` header (or `X-Api-Key`).
- The dashboard stores the token in browser local storage under `_helix_api_token` and reuses it for protected API calls.
- The CLI reuses `HELIX_API_KEY` or `ADMIN_TOKEN` from `~/.helix/auth.json` (or environment variables) when calling protected local runtime endpoints.
