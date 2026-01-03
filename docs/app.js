/* eslint-disable no-alert */
const STORAGE_KEY = "vc_salesforce_prompt_template_v1";

const $ = (id) => document.getElementById(id);

function nowIsoDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function safe(v) {
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

function bulletsFromTextarea(text) {
  const raw = safe(text);
  if (!raw) return [];
  return raw
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s?/, "").trim())
    .filter(Boolean);
}

function joinBullets(items) {
  if (!items || items.length === 0) return "- (none provided)";
  return items.map((x) => `- ${x}`).join("\n");
}

function buildArtifactChecklist(artifact) {
  switch (artifact) {
    case "LWC":
      return [
        "Use Lightning Design System patterns; ensure accessibility (ARIA, keyboard navigation).",
        "Prefer Lightning Data Service where appropriate; otherwise call Apex via @wire / imperative calls with clear error states.",
        "Follow LWC best practices: small components, clear public APIs, tracked state, avoid unnecessary rerenders.",
        "Security: enforce CRUD/FLS in Apex, sanitize user input, avoid exposing sensitive fields.",
        "Testing: include Jest tests for UI logic where useful and Apex tests for server-side behavior.",
        "Performance: avoid N+1 call patterns; cache read-only data where appropriate; minimize DOM work.",
      ];
    case "Apex":
      return [
        "Bulk-safe, governor-limit aware, no SOQL/DML in loops.",
        "CRUD/FLS enforcement and sharing model alignment (with sharing / without sharing justified).",
        "Use service-layer patterns; keep triggers thin (if triggers are involved).",
        "Use Named Credentials for callouts; handle retries/timeouts; surface errors safely.",
        "Use meaningful exceptions, logs (as appropriate), and deterministic behavior.",
        "Provide clear unit test strategy and test data setup.",
      ];
    case "TestClass":
      return [
        "Deterministic tests with clear arrange/act/assert; assert outcomes, not implementation details.",
        "Use realistic test data; prefer factory methods; avoid SeeAllData unless explicitly required.",
        "Cover success and failure paths; validate exceptions/messages when relevant.",
        "Exercise bulk behavior (200 records) where applicable.",
        "Validate security behavior (sharing, CRUD/FLS) if part of requirements.",
      ];
    case "Flow":
      return [
        "Choose the right flow type (screen/record-triggered/scheduled/autolaunched) based on requirements.",
        "Use clear naming conventions; document inputs/outputs; avoid hardcoding IDs.",
        "Design for performance: minimize queries/loops; prefer Get Records with selective filters.",
        "Use fault paths; user-friendly error handling; avoid data loss and partial updates.",
        "Use subflows for reuse; keep flows maintainable; include versioning notes.",
      ];
    case "Object":
      return [
        "Model for reporting, scale, and maintainability; choose lookup vs master-detail intentionally.",
        "Define field types, validation rules, record types, page layouts, and automation boundaries.",
        "Plan security: OWD, role hierarchy effects, sharing rules, permission sets, FLS.",
        "Consider data lifecycle, ownership, audit fields, and integration identifiers.",
        "Avoid redundant automation; define where logic lives (Flow vs Apex) and why.",
      ];
    default:
      return [];
  }
}

function artifactName(artifact) {
  switch (artifact) {
    case "LWC":
      return "Lightning Web Component (LWC)";
    case "Apex":
      return "Apex";
    case "TestClass":
      return "Apex Test Class";
    case "Flow":
      return "Flow";
    case "Object":
      return "Object / Data Model";
    default:
      return artifact;
  }
}

function workProductGuidance(workProduct) {
  switch (workProduct) {
    case "Story":
      return {
        outcomes: [
          "A well-formed story with title, narrative, scope, assumptions, acceptance criteria, and out-of-scope items.",
          "A validation checklist (security/perf/governor limits/testing/UX).",
          "Explicit dependencies and questions if information is missing.",
        ],
        outputFormat: [
          "Title",
          "Narrative (As a / I want / So that)",
          "In scope / Out of scope",
          "Acceptance Criteria (bullet list)",
          "Non-functional requirements",
          "Dependencies & Risks",
          "Open Questions",
        ],
      };
    case "Design":
      return {
        outcomes: [
          "A technical design with components, data model, automation boundaries, and integration approach.",
          "Trade-offs, risks, and mitigations.",
          "A build plan with sequencing and test strategy.",
        ],
        outputFormat: [
          "Context & Goals",
          "Assumptions",
          "Proposed Solution (components + responsibilities)",
          "Data Model / Security Model",
          "Automation & Integration",
          "Error Handling / Observability",
          "Testing Strategy",
          "Risks & Alternatives",
          "Implementation Plan",
        ],
      };
    case "Build":
    default:
      return {
        outcomes: [
          "Correct, production-ready implementation artifacts aligned to Salesforce best practices.",
          "Explanation of key decisions and how they meet constraints/guardrails.",
          "A test plan (and tests where applicable).",
        ],
        outputFormat: [
          "Overview",
          "Implementation (code / metadata)",
          "Configuration steps (if any)",
          "Testing (unit + manual)",
          "Notes / Trade-offs",
        ],
      };
  }
}

function orgModeGuidance(orgMode) {
  if (orgMode === "ExistingOrg") {
    return {
      contextAddendum: [
        "This is an existing Salesforce org. Before building anything, you MUST first propose an inventory/analysis plan to understand the current state and avoid duplicating functionality.",
        "You MUST identify existing components that can be reused or extended, and you MUST call out dependencies/impacts.",
      ],
      firstStep: [
        "Step 0 (Discovery): list exactly what you need to inspect (objects/fields, flows, LWCs, Apex classes, permission sets, sharing model, managed packages, naming conventions, integrations) and the questions you must answer before implementation.",
        "Only after discovery should you propose the solution and generate code/metadata.",
      ],
    };
  }
  return {
    contextAddendum: [
      "This is a greenfield build for the described scope. You may propose sensible defaults, but you MUST label assumptions and keep them minimal.",
    ],
    firstStep: [
      "Step 0 (Assumptions): if key details are missing, list clarifying questions and proceed only with clearly stated assumptions.",
    ],
  };
}

function buildPrompt(modelInputs) {
  const persona = safe(modelInputs.persona);
  const artifact = safe(modelInputs.artifact);
  const workProduct = safe(modelInputs.workProduct);
  const orgMode = safe(modelInputs.orgMode);

  const goal = safe(modelInputs.goal);
  const objects = safe(modelInputs.objects);
  const users = safe(modelInputs.users);
  const requirements = bulletsFromTextarea(modelInputs.requirements);
  const constraints = bulletsFromTextarea(modelInputs.constraints);
  const existingComponents = safe(modelInputs.existingComponents);
  const orgDetails = safe(modelInputs.orgDetails);
  const integration = safe(modelInputs.integration);
  const outputStyle = safe(modelInputs.outputStyle);

  const artifactChecklist = buildArtifactChecklist(artifact);
  const work = workProductGuidance(workProduct);
  const org = orgModeGuidance(orgMode);

  const baseGuardrails = [
    "Do NOT invent org-specific names/IDs. If missing, ask questions or state assumptions explicitly.",
    "Prefer secure-by-default design: least privilege, CRUD/FLS, sharing, input validation, and safe error messages.",
    "If requirements conflict, call out the conflict and propose options rather than guessing.",
    "If you cannot safely proceed, output clarifying questions instead of code.",
    "Output must be copy/paste ready and organized using clear headings and checklists.",
  ];

  const salesforceGuardrails = [
    "No hardcoded record IDs, profile IDs, or endpoint URLs. Use metadata, Custom Metadata/Settings, Named Credentials, and labels where appropriate.",
    "Be governor-limit aware and bulk-safe (especially for Apex and record-triggered automation).",
    "Explain how the solution aligns with Salesforce best practices and what trade-offs were made.",
  ];

  const outputStyleNote =
    outputStyle === "Jira"
      ? "Format the output to be Jira-ready (concise headings + acceptance criteria)."
      : outputStyle === "Engineering"
        ? "Format the output as an engineering spec with crisp sections and decision logs."
        : "Format the output in Markdown with clear headings and bullet lists.";

  const prompt = [
    `You are a senior Salesforce ${persona} and an expert AI pair-programmer.`,
    "",
    "## Role",
    `Act as a Salesforce ${persona}. Your goal is to help produce a high-quality ${workProduct} for: ${artifactName(artifact)}.`,
    "",
    "## Context",
    `- Date: ${nowIsoDate()}`,
    `- Artifact type: ${artifactName(artifact)}`,
    `- Work product: ${workProduct}`,
    `- Org mode: ${orgMode === "ExistingOrg" ? "Existing org (analyze first)" : "Greenfield (build from scratch)"}`,
    `- Goal: ${goal || "(not provided)"}`,
    `- Primary object(s): ${objects || "(not provided)"}`,
    `- Users/personas: ${users || "(not provided)"}`,
    "",
    "### Requirements",
    joinBullets(requirements),
    "",
    orgDetails ? "### Org details\n" + orgDetails : "",
    integration ? "### Data / integration\n" + integration : "",
    orgMode === "ExistingOrg"
      ? `### Known existing components / constraints\n${existingComponents || "(none provided)"}`
      : "",
    "",
    "## Constraints",
    joinBullets(
      constraints.length ? constraints : ["Follow Salesforce best practices and the org’s established patterns and naming conventions."]
    ),
    "",
    "## Guardrails",
    joinBullets([...baseGuardrails, ...salesforceGuardrails, ...artifactChecklist]),
    "",
    "## Outcomes (definition of done)",
    joinBullets(work.outcomes),
    "",
    "## Process",
    joinBullets(org.firstStep),
    "",
    "## Output format",
    `- ${outputStyleNote}`,
    ...work.outputFormat.map((x) => `- Include section: ${x}`),
    "",
    "## Required final checks",
    joinBullets([
      "Confirm you met the goal and each requirement.",
      "List any assumptions and open questions.",
      "List security considerations (CRUD/FLS/sharing/PII).",
      "List testing approach (unit + manual).",
      "If generating code/metadata, ensure naming is consistent and all referenced fields/objects are defined.",
    ]),
  ]
    .filter((x) => x !== "")
    .join("\n");

  return prompt.trim() + "\n";
}

function readStateFromUI() {
  return {
    persona: $("persona").value,
    artifact: $("artifact").value,
    workProduct: $("workProduct").value,
    orgMode: $("orgMode").value,
    goal: $("goal").value,
    objects: $("objects").value,
    users: $("users").value,
    requirements: $("requirements").value,
    existingComponents: $("existingComponents").value,
    constraints: $("constraints").value,
    outputStyle: $("outputStyle").value,
    orgDetails: $("orgDetails").value,
    integration: $("integration").value,
  };
}

function writeStateToUI(state) {
  const s = state || {};
  $("persona").value = s.persona || "Developer";
  $("artifact").value = s.artifact || "LWC";
  $("workProduct").value = s.workProduct || "Build";
  $("orgMode").value = s.orgMode || "Greenfield";
  $("goal").value = s.goal || "";
  $("objects").value = s.objects || "";
  $("users").value = s.users || "";
  $("requirements").value = s.requirements || "";
  $("existingComponents").value = s.existingComponents || "";
  $("constraints").value = s.constraints || "";
  $("outputStyle").value = s.outputStyle || "Markdown";
  $("orgDetails").value = s.orgDetails || "";
  $("integration").value = s.integration || "";
}

function updateExistingOrgVisibility() {
  const isExisting = $("orgMode").value === "ExistingOrg";
  $("existingOrgFields").hidden = !isExisting;
}

function updatePrompt() {
  updateExistingOrgVisibility();
  const state = readStateFromUI();
  const prompt = buildPrompt(state);
  $("output").value = prompt;

  const meta = `${state.persona} • ${artifactName(state.artifact)} • ${state.orgMode === "ExistingOrg" ? "Existing org" : "Greenfield"} • ${state.workProduct}`;
  $("promptMeta").textContent = meta;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

async function copyPrompt() {
  const text = $("output").value || "";
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback
    $("output").focus();
    $("output").select();
    document.execCommand("copy");
  }
}

function downloadPrompt() {
  const state = readStateFromUI();
  const nameParts = [
    "prompt",
    state.artifact.toLowerCase(),
    state.orgMode === "ExistingOrg" ? "existing-org" : "greenfield",
    state.workProduct.toLowerCase(),
  ];
  const filename = `${nameParts.join("_")}.md`;
  const blob = new Blob([$("output").value || ""], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resetAll() {
  localStorage.removeItem(STORAGE_KEY);
  writeStateToUI({
    persona: "Developer",
    artifact: "LWC",
    workProduct: "Build",
    orgMode: "Greenfield",
    goal: "",
    objects: "",
    users: "",
    requirements: "",
    existingComponents: "",
    constraints: "",
    outputStyle: "Markdown",
    orgDetails: "",
    integration: "",
  });
  updatePrompt();
}

function init() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    saved = null;
  }
  if (saved) writeStateToUI(saved);
  updatePrompt();

  const inputs = [
    "persona",
    "artifact",
    "workProduct",
    "orgMode",
    "goal",
    "objects",
    "users",
    "requirements",
    "existingComponents",
    "constraints",
    "outputStyle",
    "orgDetails",
    "integration",
  ];
  for (const id of inputs) {
    $(id).addEventListener("input", updatePrompt);
    $(id).addEventListener("change", updatePrompt);
  }

  $("btnCopy").addEventListener("click", copyPrompt);
  $("btnCopy2").addEventListener("click", copyPrompt);
  $("btnDownload").addEventListener("click", downloadPrompt);
  $("btnReset").addEventListener("click", resetAll);
}

document.addEventListener("DOMContentLoaded", init);

