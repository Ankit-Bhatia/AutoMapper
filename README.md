# Vibe Coding Prompt Templates — Salesforce

Static web application to generate **AI prompt templates** for Salesforce development using prompt engineering best practices:

- **Role**
- **Context**
- **Constraints**
- **Guardrails**
- **Outcomes (definition of done)**

It supports prompt templates for:

- **LWC**
- **Apex**
- **Apex Test Classes**
- **Flows**
- **Objects / Data Model**

And supports two delivery modes:

- **Greenfield**: build from scratch
- **Existing org**: *force discovery/analysis of existing components first*, then build

## How to use

- Open the app (see GitHub Pages instructions below)
- Fill in the inputs (goal, objects, requirements, constraints, org context)
- Click **Copy prompt** and paste into your AI tool

## GitHub Pages hosting

This repo is designed to be hosted via GitHub Pages from the `docs/` folder.

1. In GitHub: **Settings → Pages**
2. Set **Source** to **Deploy from a branch**
3. Select your branch (e.g. `main`) and folder **`/docs`**
4. Save — GitHub will publish a URL for the site

## Local preview

Because this is a static site, you can open it directly:

- Open `docs/index.html` in a browser

Or run a simple local server:

```bash
python3 -m http.server --directory docs 8080
```

Then visit `http://localhost:8080`.

## Repo structure

- `docs/index.html`: UI
- `docs/styles.css`: styling
- `docs/app.js`: prompt template generator logic

