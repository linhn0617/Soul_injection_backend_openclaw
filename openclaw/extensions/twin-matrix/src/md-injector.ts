import fs from "node:fs/promises";
import path from "node:path";
import { SCOPE_MAP } from "./scope-map.js";
import type { DomainProjection } from "./projection-client.js";

type InjectMeta = {
  versionId: string;
  checksum: string;
  expiry: string;
};

function formatSoulValue(key: string, value: unknown): string {
  if (typeof value !== "number") {
    return `${key}: ${JSON.stringify(value)}`;
  }
  // Add human-readable annotation for common keys
  const annotations: Record<string, Record<string, string>> = {
    visibility_preference: { low: "低調", high: "顯眼" },
    identity_expression: { low: "含蓄", high: "穿搭作為自我表達" },
    contextual_adaptability: { low: "固定風格", high: "靈活變化" },
    flavor_curiosity: { low: "保守口味", high: "勇於嘗試" },
    comfort_seeking: { low: "刺激冒險", high: "舒適首選" },
    social_dining: { low: "獨食", high: "偏好聚餐" },
    aesthetic_minimalism: { low: "豐富裝飾", high: "極簡主義" },
    functionality_priority: { low: "美感優先", high: "功能優先" },
    narrative_depth_preference: { low: "輕鬆娛樂", high: "深度敘事" },
    curiosity_breadth: { low: "專精領域", high: "廣泛涉獵" },
    natural_vs_polished: { low: "精緻妝感", high: "自然裸妝" },
  };
  const ann = annotations[key];
  if (ann) {
    const label = value < 0.5 ? ann.low : ann.high;
    return `${key}: ${value} (${label})`;
  }
  return `${key}: ${value}`;
}

function formatSkillBrandAffinity(matrix: Record<string, number>): string {
  return Object.entries(matrix)
    .sort(([, a], [, b]) => b - a)
    .map(([brand, score]) => `- ${brand}: ${score}`)
    .join("\n");
}

export async function injectDomainToMd(
  workspaceDir: string,
  domain: string,
  projection: DomainProjection,
  meta: InjectMeta,
): Promise<void> {
  const scope = SCOPE_MAP[domain];
  if (!scope) {
    throw new Error(`Unknown domain: ${domain}`);
  }

  const now = new Date().toISOString();
  const domainLabel = domain.charAt(0).toUpperCase() + domain.slice(1);

  // Write .soul.{domain}.md
  const soulLines: string[] = [
    "---",
    `versionId: ${meta.versionId}`,
    `checksum: ${meta.checksum}`,
    `scope: ${domain}`,
    `expiry: ${meta.expiry}`,
    `updatedAt: ${now}`,
    "---",
    "",
    `# Soul Matrix — ${domainLabel}`,
    "",
  ];
  for (const [key, value] of Object.entries(projection.soul)) {
    soulLines.push(formatSoulValue(key, value));
  }
  soulLines.push("");

  const soulPath = path.join(workspaceDir, scope.soul);
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(soulPath, soulLines.join("\n"), "utf-8");

  // Write .skill.{domain}.md
  const skillLines: string[] = [
    "---",
    `versionId: ${meta.versionId}`,
    `checksum: ${meta.checksum}`,
    `scope: ${domain}`,
    `expiry: ${meta.expiry}`,
    `updatedAt: ${now}`,
    "---",
    "",
    `# Skill Matrix — ${domainLabel}`,
    "",
  ];

  const skill = projection.skill as Record<string, unknown>;
  const brandMatrix = skill.brand_affinity_matrix as Record<string, number> | undefined;

  if (brandMatrix && Object.keys(brandMatrix).length > 0) {
    skillLines.push("## Brand Affinity");
    skillLines.push(formatSkillBrandAffinity(brandMatrix));
    skillLines.push("");
  }

  for (const [key, value] of Object.entries(skill)) {
    if (key === "brand_affinity_matrix") continue;
    skillLines.push(`${key}: ${value}`);
  }
  skillLines.push("");

  const skillPath = path.join(workspaceDir, scope.skill);
  await fs.writeFile(skillPath, skillLines.join("\n"), "utf-8");
}
