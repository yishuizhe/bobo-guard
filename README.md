# Bobo Guard

Bobo Guard is a local-first desktop workbench for developers who ship with AI tools, GitHub repos, and too many scattered config files.

It scans a project folder for leaked secrets, checks repository hygiene through the local GitHub credential, and produces a compact report you can copy into issues, PRs, or release notes.

## What it does

- Local secret scan for `.env`, config files, private keys, and common API token formats
- GitHub repository audit for public/private/archive/showcase recommendations
- `.gitignore` suggestions for files that should never be committed
- Copyable Markdown report with redacted findings
- Electron desktop shell with a Vite + React interface

## Privacy model

Bobo Guard reads project files locally and does not upload file contents.

The GitHub audit uses the token already available through Git Credential Manager and only requests repository metadata from GitHub's API. Secrets found in files are redacted in the UI and report.

## Development

```bash
npm install
npm run dev
```

Build the renderer:

```bash
npm run build
```

## MVP status

This first release focuses on the core loop:

1. Pick a local project folder.
2. Scan for risky secrets and weak ignore rules.
3. Audit GitHub repositories.
4. Copy a clean remediation report.

## Roadmap

- Installable pre-commit hook
- Built-in credential rotation checklist
- Safer MCP and AI-tool configuration audit
- Git history scan through gitleaks or trufflehog
- Signed desktop releases for Windows and macOS
