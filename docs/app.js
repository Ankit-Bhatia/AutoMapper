/* eslint-disable no-alert */
const STORAGE_KEY = "vc_salesforce_prompt_template_v2";

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

function roleLabel(persona) {
  switch (persona) {
    case "Developer":
      return "Salesforce Developer";
    case "Architect":
      return "Salesforce Architect";
    case "Business Analyst":
      return "Business Analyst";
    default:
      return persona || "Salesforce Developer";
  }
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

function orgModeGuidance(orgMode) {
  if (orgMode === "ExistingOrg") {
    return {
      discoveryDirective: [
        "This is an existing Salesforce org.",
        "Your first task is discovery: propose an inventory/analysis plan to understand existing components and avoid duplicating functionality.",
        "Do not produce production-ready code until discovery questions are answered; provide a plan, assumptions, and options.",
      ],
    };
  }
  return {
    discoveryDirective: [
      "This is a greenfield build (from scratch).",
      "If key information is missing, ask clarifying questions before proceeding; if you must proceed, label assumptions explicitly and keep them minimal.",
    ],
  };
}

function defaultTask({ persona, artifact, workProduct, orgMode }) {
  const role = roleLabel(persona);
  const artifactLabel = artifactName(artifact);
  if (workProduct === "Story") return `Create user stories and acceptance criteria for: ${artifactLabel}.`;
  if (workProduct === "Design") return `Design a solution architecture / technical design for: ${artifactLabel}.`;
  if (orgMode === "ExistingOrg") return `Understand existing Salesforce org components, then plan and implement changes for: ${artifactLabel}.`;
  if (role === "Business Analyst") return `Create user stories and acceptance criteria for: ${artifactLabel}.`;
  if (role === "Salesforce Architect") return `Design solution architecture and implementation approach for: ${artifactLabel}.`;
  return `Write implementation artifacts for: ${artifactLabel}.`;
}

function buildPrompt(modelInputs) {
  const persona = safe(modelInputs.persona);
  const artifact = safe(modelInputs.artifact);
  const workProduct = safe(modelInputs.workProduct);
  const orgMode = safe(modelInputs.orgMode);

  const projectName = safe(modelInputs.projectName);
  const businessObjective = safe(modelInputs.businessObjective);
  const products = safe(modelInputs.products);
  const objects = safe(modelInputs.objects);
  const users = safe(modelInputs.users);
  const functionalScope = safe(modelInputs.functionalScope);
  const nfrSecurity = safe(modelInputs.nfrSecurity);
  const nfrPerformance = safe(modelInputs.nfrPerformance);
  const nfrScalability = safe(modelInputs.nfrScalability);
  const nfrCompliance = safe(modelInputs.nfrCompliance);
  const task = safe(modelInputs.task);
  const additionalConstraints = bulletsFromTextarea(modelInputs.constraints);
  const existingComponents = safe(modelInputs.existingComponents);
  const orgDetails = safe(modelInputs.orgDetails);
  const integration = safe(modelInputs.integration);
  const additionalNotes = safe(modelInputs.additionalNotes);
  const outputStyle = safe(modelInputs.outputStyle);

  const artifactChecklist = buildArtifactChecklist(artifact);
  const org = orgModeGuidance(orgMode);

  const mustConstraints = [
    "Follow Salesforce best practices",
    "Assume enterprise-scale usage",
    "Avoid hardcoding values",
    "Ensure bulkification and governor limit safety",
    "Design for maintainability and extensibility",
    "Use declarative approaches before code where appropriate",
    "Clearly separate concerns (UI, service, data layers)",
    ...artifactChecklist,
  ];

  const mustNotConstraints = [
    "Bypass Salesforce security model",
    "Use deprecated features",
    "Assume admin-level permissions for users",
    "Produce production-ready code without explanation",
  ];

  const guardrails = [
    "Treat AI output as a first draft, not final authority",
    "Clearly call out assumptions",
    "Explicitly list risks and trade-offs",
    "Provide alternatives where applicable",
    "Do NOT hallucinate Salesforce features",
    "Do NOT invent org-specific names/IDs. If missing, ask clarifying questions.",
  ];

  const outputStyleNote =
    outputStyle === "Jira"
      ? "Use concise, Jira-ready phrasing, but keep the required 1–9 section structure."
      : outputStyle === "Engineering"
        ? "Use engineering-spec depth, but keep the required 1–9 section structure."
        : "Use clear Markdown, but keep the required 1–9 section structure.";

  const effectiveTask =
    task || defaultTask({ persona, artifact, workProduct, orgMode });

  const role = roleLabel(persona);

  const prompt = [
    "",
    "ROLE",
    "You are acting as a senior Salesforce professional based on the role specified below.",
    `Role: ${role}`,
    "",
    "You must respond strictly from this role’s perspective.",
    "",
    "--------------------------------------------------",
    "",
    "CONTEXT",
    `Project / Feature Name:\n${projectName || "(not provided)"}`,
    "",
    `Business Objective:\n${businessObjective || "(not provided)"}`,
    "",
    `Salesforce Clouds / Products in Scope:\n${products || "(not provided)"}`,
    "",
    `Users & Personas:\n${users || "(not provided)"}`,
    "",
    `Functional Scope:\n${functionalScope || "(not provided)"}`,
    "",
    "Non-Functional Requirements:",
    `- Security:\n  ${nfrSecurity || "(not provided)"}`,
    `- Performance:\n  ${nfrPerformance || "(not provided)"}`,
    `- Scalability:\n  ${nfrScalability || "(not provided)"}`,
    `- Compliance (PII, GDPR, etc.):\n  ${nfrCompliance || "(not provided)"}`,
    "",
    `Primary object(s):\n${objects || "(not provided)"}`,
    "",
    `Org mode:\n${orgMode === "ExistingOrg" ? "Existing org (understand existing components first)" : "Greenfield (build from scratch)"}`,
    "",
    orgDetails ? `Org details:\n${orgDetails}` : "",
    integration ? `Data / integration:\n${integration}` : "",
    orgMode === "ExistingOrg"
      ? `Known existing components / constraints:\n${existingComponents || "(none provided)"}`
      : "",
    additionalNotes ? `Additional notes:\n${additionalNotes}` : "",
    "",
    "",
    "--------------------------------------------------",
    "",
    "TASK",
    "Based on the role specified, perform the following task:",
    effectiveTask,
    "",
    `Artifact type: ${artifactName(artifact)}`,
    `Work product: ${workProduct}`,
    "",
    ...org.discoveryDirective.map((x) => `- ${x}`),
    "",
    "",
    "--------------------------------------------------",
    "",
    "CONSTRAINTS (NON-NEGOTIABLE)",
    "You must:",
    joinBullets(mustConstraints),
    "",
    "You must NOT:",
    joinBullets(mustNotConstraints),
    "",
    additionalConstraints.length ? "Additional constraints:\n" + joinBullets(additionalConstraints) : "",
    "",
    "",
    "--------------------------------------------------",
    "",
    "GUARDRAILS",
    joinBullets(guardrails),
    "",
    "",
    "--------------------------------------------------",
    "",
    "EXPECTED OUTPUT FORMAT",
    outputStyleNote,
    "",
    "Provide your response in the following structure:",
    "",
    "1. Understanding of the Requirement",
    "2. Assumptions",
    "3. Recommended Salesforce Approach",
    "4. Architecture / Design (if applicable)",
    "5. Data Model Impact",
    "6. Security & Access Considerations",
    "7. Performance & Governor Limit Considerations",
    "8. Risks & Mitigations",
    "9. Next Steps",
    "",
    "",
    "--------------------------------------------------",
    "",
    "QUALITY BAR",
    "If information is missing, ask clarifying questions before proceeding.",
    "Accuracy and Salesforce correctness take priority over speed.",
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
    projectName: $("projectName").value,
    businessObjective: $("businessObjective").value,
    products: $("products").value,
    objects: $("objects").value,
    users: $("users").value,
    functionalScope: $("functionalScope").value,
    nfrSecurity: $("nfrSecurity").value,
    nfrPerformance: $("nfrPerformance").value,
    nfrScalability: $("nfrScalability").value,
    nfrCompliance: $("nfrCompliance").value,
    task: $("task").value,
    existingComponents: $("existingComponents").value,
    constraints: $("constraints").value,
    outputStyle: $("outputStyle").value,
    orgDetails: $("orgDetails").value,
    integration: $("integration").value,
    additionalNotes: $("additionalNotes").value,
  };
}

function writeStateToUI(state) {
  const s = state || {};
  $("persona").value = s.persona || "Developer";
  $("artifact").value = s.artifact || "LWC";
  $("workProduct").value = s.workProduct || "Build";
  $("orgMode").value = s.orgMode || "Greenfield";
  $("projectName").value = s.projectName || "";
  $("businessObjective").value = s.businessObjective || "";
  $("products").value = s.products || "";
  $("objects").value = s.objects || "";
  $("users").value = s.users || "";
  $("functionalScope").value = s.functionalScope || "";
  $("nfrSecurity").value = s.nfrSecurity || "";
  $("nfrPerformance").value = s.nfrPerformance || "";
  $("nfrScalability").value = s.nfrScalability || "";
  $("nfrCompliance").value = s.nfrCompliance || "";
  $("task").value = s.task || "";
  $("existingComponents").value = s.existingComponents || "";
  $("constraints").value = s.constraints || "";
  $("outputStyle").value = s.outputStyle || "Standard";
  $("orgDetails").value = s.orgDetails || "";
  $("integration").value = s.integration || "";
  $("additionalNotes").value = s.additionalNotes || "";
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

  const metaLeft = `${roleLabel(state.persona)} • ${artifactName(state.artifact)} • ${state.orgMode === "ExistingOrg" ? "Existing org" : "Greenfield"} • ${state.workProduct}`;
  const meta = state.projectName ? `${metaLeft} • ${state.projectName}` : metaLeft;
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
  const pn = safe(state.projectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const nameParts = [
    "prompt",
    state.artifact.toLowerCase(),
    state.orgMode === "ExistingOrg" ? "existing-org" : "greenfield",
    state.workProduct.toLowerCase(),
    pn || null,
  ];
  const filename = `${nameParts.filter(Boolean).join("_")}.md`;
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
    projectName: "",
    businessObjective: "",
    products: "",
    objects: "",
    users: "",
    functionalScope: "",
    nfrSecurity: "",
    nfrPerformance: "",
    nfrScalability: "",
    nfrCompliance: "",
    task: "",
    existingComponents: "",
    constraints: "",
    outputStyle: "Standard",
    orgDetails: "",
    integration: "",
    additionalNotes: "",
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
    "projectName",
    "businessObjective",
    "products",
    "objects",
    "users",
    "functionalScope",
    "nfrSecurity",
    "nfrPerformance",
    "nfrScalability",
    "nfrCompliance",
    "task",
    "existingComponents",
    "constraints",
    "outputStyle",
    "orgDetails",
    "integration",
    "additionalNotes",
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

