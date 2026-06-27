# Autonomous Workstation Documentation

Welcome to the Human OS autonomous software engineering workstation configuration. This file documents variables, backup strategies, and optional integrations to enable completely autonomous operations on this development machine.

---

## 1. Environment Variables

Configure the following variables in `backend/.env`:

| Variable Name | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes (for DDL) | Direct Postgres connection string (used for migrations/resets/doctor). |
| `SUPABASE_URL` | Yes | HTTP URL for Supabase API client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | API service role key for admin operations bypassing RLS. |
| `SAFETY_MODE` | No | Set to `production` to block dangerous database drops. |
| `GITHUB_TOKEN` | No (Optional) | GitHub Personal Access Token for checking repo status. |
| `RENDER_API_KEY` | No (Optional) | Render API token for monitoring cloud deployment health. |

---

## 2. Security Roles & Permissions

For local and staging database access, ensure the following permissions are granted to the Supabase API users:
```sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
```
*Note: The `db_migrate.ts` and `db_reset.ts` scripts execute this automatically.*

---

## 3. Backup Strategy
- **Command:** `npm run db:backup`
- **Output:** Saves table schemas and row contents as timestamped JSON files into `backend/backups/`.
- **Strategy:** Lightweight, portable JSON format ensuring backups remain fully database-independent and easy to migrate.

---

## 4. MCP Integrations (Optional)

Configure these Model Context Protocol (MCP) integrations inside your IDE settings (`cortex-config.json` or `.clinerules`) to allow your LLM subagents to autonomously query health, check builds, or inspect tables:

### A. Supabase MCP
Allows LLM tools to pull table lists, schemas, and logs.
```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server"],
      "env": {
        "SUPABASE_URL": "your_supabase_url",
        "SUPABASE_SERVICE_ROLE_KEY": "your_service_role_key"
      }
    }
  }
}
```

### B. GitHub MCP
Allows managing issues, PRs, and triggers.
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token"
      }
    }
  }
}
```

### C. Render MCP
Allows triggering deploys or checking build health.
```json
{
  "mcpServers": {
    "render": {
      "command": "npx",
      "args": ["-y", "@render/mcp-server"],
      "env": {
        "RENDER_API_KEY": "your_render_api_key"
      }
    }
  }
}
```
