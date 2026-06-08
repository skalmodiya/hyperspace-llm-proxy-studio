# Hyperspace LLM Proxy Studio

A modern, production-ready web app for exploring and using the **Hyperspace LLM Proxy** —
a single deployable Next.js 16 application that supports chat, embeddings, model discovery,
and proxy health monitoring across **Anthropic**, **OpenAI**, **Gemini**, and **LiteLLM**.

> **Architecture**: single Next.js App Router app. All proxy traffic is server-side. The
> browser never sees the proxy URL or the API key. The provider layer is framework-independent
> and designed to be extracted into a standalone SDK, Express service, SAP CAP service, CLI,
> or VS Code extension without rewrites.

## Features

- 📊 **Dashboard** — proxy reachability, per-provider health, model counts
- 💬 **Chat Playground** — provider/model selector, temperature, max-tokens, streaming,
  system prompt, conversation history, markdown + code-block highlighting,
  Perplexity citation rendering, copy / export, raw JSON inspector
- ✨ **Embeddings Playground** — single + batch, OpenAI-compatible AND Gemini formats
  (with `task_type` + optional `title`), dimension count, vector preview, copy
- 🧭 **Model Explorer** — dynamically discovered, search, provider/type filters
- ❤️ **Proxy Health** — per-provider probes with latency
- ⚙️ **Settings** — proxy URL, API key (masked, server-only), timeout, retry,
  default provider/model/temperature/max-tokens/streaming/system prompt
- 🌗 **Dark / Light mode** with system fallback
- 📱 Responsive, mobile-friendly layout

## Stack

- **Next.js 16** (App Router, RSC, Route Handlers, Turbopack)
- **React 19** + **TypeScript**
- **Tailwind CSS v4** + ShadCN-style primitives
- **TanStack Query** (server state) + **Zustand** (client preferences, persisted)
- **Zod** (request validation, server + client)
- **react-markdown** + **rehype-highlight** (chat rendering)
- **Vitest** + React Testing Library (tests)

## Quick start

```bash
# 1. Install
npm install

# 2. Configure environment
cp .env.example .env.local
# Edit .env.local — set HYPERSPACE_PROXY_URL and HYPERSPACE_API_KEY

# 3. Run
npm run dev   # http://localhost:3000

# 4. Tests + typecheck + build
npm run test
npm run typecheck
npm run build
```

## Environment

All variables are **server-side only**. The browser never receives them.

| Variable                        | Default                  | Purpose                                            |
| ------------------------------- | ------------------------ | -------------------------------------------------- |
| `HYPERSPACE_PROXY_URL`          | `http://localhost:6655`  | Base URL of the Hyperspace LLM Proxy.              |
| `HYPERSPACE_API_KEY`            | _(empty)_                | Bearer token sent on every upstream call.          |
| `HYPERSPACE_REQUEST_TIMEOUT_MS` | `60000`                  | Per-request timeout.                               |
| `HYPERSPACE_RETRY_COUNT`        | `2`                      | Retries on 5xx / 429 / transient network errors.   |
| `HYPERSPACE_DEBUG`              | `false`                  | Reserved for verbose server-side logging.          |
| `NEXT_PUBLIC_APP_NAME`          | _Hyperspace LLM …_       | Public app label.                                  |

The Settings page also exposes runtime overrides for the proxy URL, API key, timeout,
and retry count. Overrides live in server memory and reset on cold start.

## Architecture

```
Browser
  ↓ fetch('/api/...')
Next.js Route Handler  (src/app/api/*)
  ↓ uses provider adapter
LLMProvider                 (src/lib/providers/*)
  ↓ Bearer-authed fetch
Hyperspace Proxy (http://localhost:6655)
  ↓
Anthropic / OpenAI / Gemini / LiteLLM
```

### Provider abstraction (`src/lib/providers/`)

Every provider implements the same interface:

```ts
interface LLMProvider {
  readonly id: ProviderId;
  listModels(): Promise<Model[]>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  chatStream?(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatStreamChunk>;
  embeddings?(req: EmbeddingRequest): Promise<EmbeddingResponse>;
}
```

Files:

```
src/lib/providers/
├── types.ts        # interface, ChatRequest/Response, ProviderError
├── base.ts         # shared HTTP, retry, SSE parser
├── anthropic.ts    # /anthropic/v1/messages + /models
├── openai.ts       # /openai/v1/chat/completions, /embeddings, /models
├── gemini.ts       # /gemini/v1beta/models/{m}:generateContent / :embedContent
├── litellm.ts      # /litellm/v1/* (OpenAI-compatible, Perplexity citations)
└── index.ts        # registry: getProvider(id)
```

The adapters depend only on the Web Fetch API + `getEffectiveEnv()`. They do not import
from Next.js or React. To extract them:

1. Move `src/lib/providers/` to a standalone package.
2. Replace `getEffectiveEnv` with a passed-in config object.
3. Publish.

### Route Handlers (`src/app/api/`)

| Path                | Method   | Purpose                                                       |
| ------------------- | -------- | ------------------------------------------------------------- |
| `/api/health`       | GET      | Proxy reachability + per-provider latency probes.             |
| `/api/models`       | GET      | Aggregated models across providers (or `?provider=...`).      |
| `/api/chat`         | POST     | Chat completion (set `stream:true` for SSE response).         |
| `/api/embeddings`   | POST     | Embeddings — single string or array of strings.               |
| `/api/settings`     | GET/PATCH| Read effective config; PATCH applies runtime overrides.       |

All payloads are validated with Zod schemas (`src/lib/schemas.ts`).

## Supported providers & models

### Anthropic — `/anthropic/v1`
`anthropic--claude-4.7-opus`, `anthropic--claude-4.6-sonnet`,
`anthropic--claude-4.6-opus`, `anthropic--claude-4.5-haiku`,
`anthropic--claude-4.5-sonnet`, `anthropic--claude-4.5-opus`,
`anthropic--claude-4-sonnet`

### OpenAI — `/openai/v1`
Chat: `gpt-5.4`, `gpt-5`, `gpt-5-mini`, `gpt-4.1`, `gpt-4.1-mini`
Embeddings: `text-embedding-3-small`, `text-embedding-3-large`

### Gemini — `/gemini`
Chat: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite`
Embeddings: `gemini-embedding`
Task types: `RETRIEVAL_QUERY`, `RETRIEVAL_DOCUMENT`, `SEMANTIC_SIMILARITY`,
`CLASSIFICATION`, `CLUSTERING`

### LiteLLM — `/litellm/v1`
Unified OpenAI-compatible access to all providers, including **Perplexity** (`sonar`,
`sonar-pro`) with streamed and non-streamed citations.

> Models are **always discovered dynamically** via each provider's `/models` endpoint.
> The hardcoded lists above are only used as fallbacks if the proxy is unreachable.

## Source control

This project lives on **two GitHub remotes**:

| Remote | Host | Visibility | Purpose |
|---|---|---|---|
| `origin`  | `github.tools.sap`           | private | SAP-internal canonical repository |
| `public`  | `github.com`                 | public  | Community-facing mirror, also where Vercel deployments connect |

If you only need one of them, skip the steps for the other. Pushes are independent.

### Pre-flight: never commit secrets

The following files **must stay out of git**. They're already in `.gitignore`,
but verify before every push:

- `.env` and any `.env.*` files (contain API keys)
- `docker.env` (the Docker-runtime equivalent)
- `aicore-key.json` and any `*-service-key.json` (raw SAP AI Core service keys)

```bash
# Confirm each is ignored before pushing.
for f in .env.local docker.env aicore-key.json; do
  [ -f "$f" ] && git check-ignore -q "$f" \
    && echo "[ignored ✓] $f" \
    || echo "[CHECK ✗] $f"
done
```

### One-time setup — `gh` CLI on both hosts

```bash
# Install (Windows: winget install GitHub.cli   |   macOS: brew install gh)
gh --version

# Log in to the public GitHub
gh auth login --hostname github.com --git-protocol https --web

# Log in to SAP-internal GitHub. Choose "HTTPS" + "Login with a web browser".
# You'll be redirected through the SAP IdP for SSO.
gh auth login --hostname github.tools.sap --git-protocol https --web

# Verify both
gh auth status
```

### One-time setup — initial commit and remotes

```bash
# 1. From the project root:
git init                 # if not already a repo
git checkout -b main     # standard default branch

# 2. Stage + commit (gitignored secret files are skipped automatically)
git add .
git commit -m "feat: initial commit — Hyperspace LLM Proxy Studio"

# 3a. Create the SAP-internal repo and set as `origin`
gh repo create github.tools.sap/<your-org>/hyperspace-llm-proxy-studio \
  --private \
  --source=. \
  --remote=origin \
  --description "Hyperspace LLM Proxy Studio — SAP AI Core + multi-provider"

# 3b. Create the public mirror and set as `public`
gh repo create <your-github-handle>/hyperspace-llm-proxy-studio \
  --public \
  --source=. \
  --remote=public \
  --description "Hyperspace LLM Proxy Studio — public mirror"

# 4. Push to both
git push -u origin  main
git push -u public  main
```

`gh repo create --source=. --remote=<name>` does three things in one shot:
creates the repo on the host, adds it as a git remote, and pushes the
current branch. If you'd rather see each step explicitly, the long form is:

```bash
gh repo create github.tools.sap/<your-org>/hyperspace-llm-proxy-studio --private
git remote add origin https://github.tools.sap/<your-org>/hyperspace-llm-proxy-studio.git
git push -u origin main
```

### Ongoing — push to one or both remotes

```bash
# Default — go to SAP-internal only.
git push

# Mirror to public github.com when you're ready.
git push public main

# Sync both at once (handy after a release commit).
git push origin main && git push public main
```

### Cloning fresh on a new machine

```bash
# SAP-internal canonical (recommended for development):
gh repo clone github.tools.sap/<your-org>/hyperspace-llm-proxy-studio
cd hyperspace-llm-proxy-studio

# Then add the public mirror as a second remote so you can push there too.
git remote add public https://github.com/<your-github-handle>/hyperspace-llm-proxy-studio.git
git remote -v
```

After cloning you'll need the gitignored config files. They're not in git on
purpose — re-create from the templates:

```bash
cp .env.example   .env.local       # fill in HYPERSPACE_API_KEY (if you use the proxy)
cp docker.env.example docker.env   # fill in HYPERSPACE_API_KEY for the container

# Drop your SAP AI Core service key (downloaded from BTP cockpit) here.
# The file is gitignored.
nano aicore-key.json               # or your editor of choice
```

Then `npm install && npm run dev` for local development, or `docker compose up -d`
for the containerized runtime.

## Deployment

### Local development
```bash
npm run dev
```

### Docker
```bash
docker build -t hyperspace-llm-proxy-studio .
docker run --rm -p 3000:3000 \
  -e HYPERSPACE_PROXY_URL=http://host.docker.internal:6655 \
  -e HYPERSPACE_API_KEY=sk-... \
  hyperspace-llm-proxy-studio
```

### Docker Compose
```bash
docker compose up --build
```

The compose file maps `host.docker.internal` for Linux/Docker Desktop so the container
can reach a proxy running on the host. Set `HYPERSPACE_PROXY_URL`, `HYPERSPACE_API_KEY`,
etc. via the shell or a top-level `.env` file.

### Vercel
The app is a single Next.js deployable. Push to a Vercel-linked repo and set the env vars
in the project settings — no extra services required. See the Vercel CLI quick path:

```bash
npm i -g vercel    # if not installed
vercel link
vercel env add HYPERSPACE_PROXY_URL
vercel env add HYPERSPACE_API_KEY
vercel deploy --prod
```

### SAP BTP — Cloud Foundry

Deploys the Approuter + studio + AI Core + XSUAA atomically via MTA. The
Hyperspace proxy and four "non-AI-Core" providers are switched **off**;
only **SAP AI Core** is exposed. The sidebar trims down to **Chat + Settings**
(via `BTP_TRIM_MODE=true`).

**Pre-requisites (one-time per BTP subaccount):**
- Entitlements: `SAP AI Core (standard)`, `Authorization and Trust Management (xsuaa application)`,
  Cloud Foundry runtime quota.
- Tools: `cf` CLI, [`mbt`](https://github.com/SAP/cloud-mta-build-tool), `cf install-plugin multiapps`.
- An SAP AI Core resource group with at least one **running** chat-capable deployment
  (Anthropic Claude on AI Core, OpenAI GPT on AI Core, etc.).

**Deploy:**
```bash
cf login -a https://api.cf.<region>.hana.ondemand.com -o <org> -s <space>

# 1. Build the MTA archive (uses approuter/, mta.yaml, xs-security.json,
#    and runs `npm ci && npm run build` for the Next.js bundle).
mbt build

# 2. Deploy the .mtar — provisions AI Core + XSUAA, binds them, starts both modules.
cf deploy mta_archives/hyperspace-llm-proxy-studio_0.1.0.mtar

# Subsequent deploys use the same command. To target a non-default AI Core
# resource group:
mbt build -e AI_RG=production
cf deploy mta_archives/hyperspace-llm-proxy-studio_0.1.0.mtar
```

**Open the app:** `cf app studio-approuter` shows the public URL. The studio
itself (`studio-srv`) has `no-route: true` and is **not** reachable from the
internet — only the Approuter is, and it enforces the XSUAA JWT.

**Assign roles:** in the BTP cockpit → Security → Role Collections, assign
**Hyperspace Studio User** (or **Admin**) to your user. The Approuter rejects
requests without the `User` scope.

**Troubleshooting:**
- `Insufficient scope` from the Approuter → role collection not assigned to
  the user yet.
- `SAP AI Core credentials not configured` in the Settings page → the
  `studio-aicore` binding is missing or empty. Run `cf bindings`.
- Runtime config changes via the Settings page only affect the **single
  instance** that handled the PATCH. Scale to 1 instance during testing or
  bake config into env vars.

### SAP BTP — Kyma

Pure Kubernetes path. Uses the **Docker image** built from the project root
(`docker buildx build --platform=linux/amd64`), the BTP Service Operator for
AI Core provisioning, and a Kyma APIRule with optional XSUAA JWT validation.

**Pre-requisites (one-time per Kyma cluster):**
- BTP Operator module installed (Kyma Console → Modules → BTP Operator).
- A `btp-operator` secret in the cluster pointing at your global account.
- An image registry the cluster can pull from (Kyma Module Registry,
  Docker Hub, GHCR, …).

**Build & push the image:**
```bash
docker buildx build --platform=linux/amd64 \
  -t <registry>/hyperspace-studio:0.1.0 .
docker push <registry>/hyperspace-studio:0.1.0
```

**Deploy:**
```bash
# 1. Edit values-prod.yaml: set image.repository, the AI Core resource group,
#    and (for jwt mode) your XSUAA issuer + jwksUri + xsappname audience.
helm upgrade --install studio charts/hyperspace-llm-proxy-studio \
  -n hyperspace --create-namespace \
  -f values-prod.yaml

# 2. Watch the BTP Service Operator provision AI Core (~30–90 seconds):
kubectl -n hyperspace get serviceinstance,servicebinding -w
```

When the `ServiceBinding` is `Ready`, a Secret named `<release>-aicore-binding`
appears in the namespace; the studio Deployment mounts it as
`AICORE_SERVICE_KEY_JSON`. Open the URL from `kubectl -n hyperspace get apirule`.

**Switching to no-auth (for a private demo):** set `apiRule.authMode: noAuth`
in `values.yaml` and re-`helm upgrade`. Don't ship that to prod.

**Trimming Embeddings/Models/Health:** already on by default
(`config.btpTrimMode: "true"`). Set to `"false"` only if your users need the
full studio.

## Testing

```bash
npm test           # run all
npm run test:watch # watch mode
```

Coverage:

- `src/lib/providers/__tests__/providers.test.ts` — adapter contract tests
  (URL, headers, request/response mapping, fallback model lists, citations)
- `src/lib/__tests__/schemas.test.ts` — Zod schema validation
- `src/components/ui/__tests__/button.test.tsx` — RTL component test

## Project layout

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts           # POST: chat (+ streaming)
│   │   ├── embeddings/route.ts     # POST: embeddings
│   │   ├── health/route.ts         # GET: proxy + provider probes
│   │   ├── models/route.ts         # GET: discovered models
│   │   └── settings/route.ts       # GET/PATCH: runtime config
│   ├── chat/page.tsx               # Chat Playground
│   ├── embeddings/page.tsx         # Embeddings Playground
│   ├── health/page.tsx             # Proxy Health
│   ├── models/page.tsx             # Model Explorer
│   ├── settings/page.tsx           # Settings
│   ├── globals.css                 # Theme tokens (light/dark)
│   ├── layout.tsx                  # Sidebar + topbar shell
│   └── page.tsx                    # Dashboard
├── components/
│   ├── app/
│   │   ├── sidebar.tsx
│   │   └── topbar.tsx
│   └── ui/                         # ShadCN-style primitives
├── lib/
│   ├── api.ts                      # Browser → /api/* TanStack Query hooks
│   ├── env.ts                      # Server-only env loader (Zod)
│   ├── http.ts                     # jsonOk / jsonError helpers
│   ├── providers/                  # ★ framework-independent adapter layer
│   ├── providers-client.tsx        # Theme + Query providers
│   ├── schemas.ts                  # Zod request schemas
│   ├── store.ts                    # Zustand preferences (persisted)
│   └── utils.ts                    # cn(), truncate, formatNumber
├── Dockerfile
├── docker-compose.yml
├── next.config.ts
├── package.json
└── vitest.config.ts
```

## Roadmap (future extensibility)

- AI agent integrations using the Vercel AI SDK + Vercel AI Gateway
- SAP BTP / CAP service that re-uses `src/lib/providers/` directly
- Standalone `@hyperspace/llm-sdk` NPM package
- VS Code extension with the same provider layer

## License

MIT — internal use for the Hyperspace LLM Proxy.
