# Devy AI Builder

Devy AI Builder is a browser-based AI app building platform for generating, editing, running, and exporting modern web projects from natural-language prompts.

It combines:
- AI chat-driven generation
- multi-file project output
- interactive file editing with Monaco
- in-browser runtime via WebContainer
- multi-agent orchestration for planning, building, reviewing, and fixing
- quality gates before accepting generated results
- local multi-project management with history, undo, and redo

## Core Capabilities

- Generate `frontend`, `backend`, and `full-stack` projects
- Use `multi-agent mode` with:
  - `Planner`
  - `Builder`
  - `Reviewer`
  - `Fixer`
- Produce and use planning artifacts:
  - `implementation.md`
  - `structure.md`
  - `task.md`
- Validate output using structured quality gates
- Run projects directly in the browser with live preview and logs
- Manage dependencies per manifest scope
- Support multiple `package.json` files
- Auto-detect paired `frontend/backend` workspaces
- Configure database providers:
  - `Supabase`
  - `Firebase`
- Export projects to ZIP or StackBlitz
- Push generated output to GitHub

## Tech Stack

### Platform
- `React 19`
- `TypeScript`
- `Vite`
- `Tailwind CSS`
- `react-resizable-panels`
- `lucide-react`
- `react-markdown`
- `motion`

### Runtime and Tooling
- `Ollama`
- `@webcontainer/api`
- `xterm`
- `@monaco-editor/react`
- `JSZip`
- `@stackblitz/sdk`

## Architecture Overview

The platform is organized around a few core layers:

- `src/hooks/useChat.ts`
  Handles prompting, streaming generation state, and orchestration lifecycle updates.

- `src/utils/orchestration.ts`
  Implements multi-agent generation with planning, build, review, fix loops, and plan-file enforcement.

- `src/utils/quality-gates.ts`
  Runs acceptance checks against generated output before the result is treated as valid.

- `src/hooks/useWebContainer.ts`
  Boots the in-browser development environment, installs dependencies, starts dev targets, and manages preview/logging.

- `src/utils/package-manifests.ts`
  Detects multiple manifests and builds workspace runtime plans for single-target or paired frontend/backend projects.

- `src/hooks/useProjects.ts`
  Persists projects, messages, files, and history in local storage.

## Multi-Agent Flow

When multi-agent mode is enabled, the system follows this sequence:

1. `Planner` creates `implementation.md`, `structure.md`, and `task.md`
2. `Builder` reads those files and executes the plan into real project files
3. `Reviewer` inspects the result against plan artifacts and implementation quality
4. `Quality Gates` validate the generated output
5. `Fixer` applies targeted repairs when gates fail

## Workspace Runtime

The runtime supports:
- `single` mode for standard projects
- `paired` mode for projects with a clear frontend/backend split

In paired mode, the platform can:
- install dependencies for multiple manifests
- start frontend and backend targets together
- show the frontend in preview
- keep backend services running in the background
- label runtime status in logs and preview UI

## Local Development

### Prerequisites
- `Node.js`
- `npm`
- local `Ollama` server

### Install
```bash
npm install
```

### Run
```bash
npm run dev
```

### Type Check
```bash
npm run lint
```

### Production Build
```bash
npm run build
```

## Notes

- The app stores project state locally in the browser.
- Generated projects may contain multiple manifests such as `client/package.json` and `server/package.json`.
- The current system is optimized for real-world app generation, but generated output should still be reviewed before production deployment.

## Documentation

Detailed platform documentation is available in:

- [PLATFORM_DOCUMENTATION.md](./PLATFORM_DOCUMENTATION.md)

## Repository

GitHub repository:

- https://github.com/El3tar-cmd/Devy-AI-Builder
