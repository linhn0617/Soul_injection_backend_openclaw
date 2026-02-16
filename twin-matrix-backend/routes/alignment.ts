import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../index.js";

type Grant = {
  userId: string;
  versionId: string;
  checksum: string;
  scope: string[];
  expiry: string;
};

type GrantsFile = {
  tokens: Record<string, Grant>;
};

export function createAlignmentRouter(): Router {
  const router = createRouter();

  router.post("/v1/match/alignment", async (req: Request, res: Response) => {
    try {
      const { token, brandAgentId, brandMatrix } = req.body as {
        token: string;
        brandAgentId: string;
        brandMatrix: Record<string, number>;
      };

      if (!token || !brandAgentId || !brandMatrix) {
        res.status(400).json({ error: "token, brandAgentId, brandMatrix are required" });
        return;
      }

      // Resolve token
      const grantsPath = path.join(DATA_DIR, "grants", "grants.json");
      let grant: Grant | null = null;
      try {
        const raw = await fs.readFile(grantsPath, "utf-8");
        const grants = JSON.parse(raw) as GrantsFile;
        const g = grants.tokens[token];
        if (g && new Date(g.expiry) > new Date()) {
          grant = g;
        }
      } catch {
        // ignore
      }

      if (!grant) {
        res.status(403).json({ error: "Invalid or expired token" });
        return;
      }

      // Load user projections for authorized scopes
      const projectionsDir = path.join(DATA_DIR, "projections");
      const versionIdClean = grant.versionId.replace("_", "");

      let soulContrib = 0;
      let skillContrib = 0;
      const reasons: string[] = [];
      let domainCount = 0;

      for (const scope of grant.scope) {
        const projPath = path.join(
          projectionsDir,
          `${grant.userId}_${versionIdClean}_${scope}.json`,
        );
        try {
          const raw = await fs.readFile(projPath, "utf-8");
          const proj = JSON.parse(raw) as {
            soul: Record<string, number>;
            skill: { brand_affinity_matrix?: Record<string, number> } & Record<string, number>;
          };

          // Soul contribution: average of soul values
          const soulVals = Object.values(proj.soul).filter((v) => typeof v === "number");
          if (soulVals.length > 0) {
            const soulAvg = soulVals.reduce((a, b) => a + b, 0) / soulVals.length;
            soulContrib += soulAvg;
            domainCount++;
          }

          // Skill contribution: brand affinity overlap
          if (proj.skill.brand_affinity_matrix && Object.keys(brandMatrix).length > 0) {
            let overlap = 0;
            let overlapCount = 0;
            for (const [brand, userAffinity] of Object.entries(proj.skill.brand_affinity_matrix)) {
              if (brandMatrix[brand] !== undefined) {
                overlap += userAffinity * brandMatrix[brand];
                overlapCount++;
                reasons.push(`${brand} affinity match: user=${userAffinity}, brand=${brandMatrix[brand]}`);
              }
            }
            if (overlapCount > 0) {
              skillContrib += overlap / overlapCount;
            }
          }
        } catch {
          // Skip missing domains
        }
      }

      if (domainCount > 0) {
        soulContrib /= domainCount;
      }
      if (grant.scope.length > 0) {
        skillContrib /= grant.scope.length;
      }

      const alignmentScore = soulContrib * 0.4 + skillContrib * 0.6;

      res.json({
        alignmentScore: Math.round(alignmentScore * 100) / 100,
        soulContrib: Math.round(soulContrib * 100) / 100,
        skillContrib: Math.round(skillContrib * 100) / 100,
        reasons,
      });
    } catch (err) {
      console.error("alignment error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
