// ============================================================================
// Profile Loader Service — Load domain-specific agent profiles
// ============================================================================
// This service provides a deterministic way to configure the bot for different
// business verticals (immobilier, garage, restaurant, etc.) using JSON profiles.
//
// PROFILE RESOLUTION:
// 1. BOT_PROFILE (explicit) → loads profiles/{id}.json
// 2. BOT_DOMAIN (fallback) → maps domain to default profile
// 3. If neither → ERROR (no silent fallback to avoid confusion)
//
// MERGE STRATEGY:
// - Profile JSON = template/defaults
// - .env variables = overrides (higher priority)
// - Final config = profile merged with .env overrides
//
// LOGGING:
// - Every load logs the profile source for audit trail
// - Errors are explicit and actionable
// ============================================================================

import fs from "fs";
import path from "path";

// ── Profile Type Definition ────────────────────────────────────────────────

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  version: string;
  domain: "immobilier" | "garage" | "generic" | "restaurant" | "oraclesentinel";
  branding: {
    companyName: string;
    companyTagline: string;
    companyWebsite: string;
    companyDescription: string;
    companyServices: string;
    targetAudience: string;
  };
  variables: Record<string, string>;
  personality: {
    role: string;
    expertise: string;
    mission: string;
    tone: string;
    writingStyle: string;
    maxResponseWords: number;
  };
  qualification: {
    requiredFields: string[];
    checklist: string[];
    scoringRules: Record<string, number>;
    minPushScore: number;
  };
  knowledgeBase: {
    urls: string[];
    maxUrls: number;
    cacheTtl: number;
  };
  metadata: {
    createdAt: string;
    updatedAt: string;
    author: string;
    tags: string[];
  };
}

// ── Profile Directory Resolution ───────────────────────────────────────────

function getProfilesDir(): string {
  // Resolve from project root (3 levels up from this file: services → src → server → root)
  return path.resolve(__dirname, "../../../profiles");
}

// ── Load Profile from JSON ─────────────────────────────────────────────────

function loadProfileFromFile(profileId: string): AgentProfile | null {
  const profilesDir = getProfilesDir();
  const profilePath = path.join(profilesDir, `${profileId}.json`);

  if (!fs.existsSync(profilePath)) {
    console.warn(
      `[ProfileLoader] Profile not found: ${profileId} (expected at ${profilePath})`,
    );
    return null;
  }

  try {
    const content = fs.readFileSync(profilePath, "utf-8");
    const profile: AgentProfile = JSON.parse(content);

    // Basic validation
    if (!profile.id || !profile.domain || !profile.branding) {
      throw new Error(`Invalid profile structure in ${profileId}.json`);
    }

    console.log(
      `[ProfileLoader] Loaded profile: ${profile.name} (${profile.id}) v${profile.version}`,
    );
    return profile;
  } catch (err: any) {
    console.error(
      `[ProfileLoader] Failed to load profile ${profileId}:`,
      err.message,
    );
    return null;
  }
}

// ── Resolve Profile ID ─────────────────────────────────────────────────────

export function resolveProfileId(): {
  profileId: string | null;
  source: "BOT_PROFILE" | "BOT_DOMAIN" | "none";
  domain: string | null;
} {
  // Priority 1: Explicit BOT_PROFILE
  const explicitProfile = process.env.BOT_PROFILE?.trim();
  if (explicitProfile) {
    return {
      profileId: explicitProfile,
      source: "BOT_PROFILE",
      domain: null, // Will be read from profile JSON
    };
  }

  // Priority 2: Fallback to BOT_DOMAIN (backward compatibility)
  const domain = (process.env.BOT_DOMAIN || "").toLowerCase().trim();
  if (domain) {
    // Map domain to default profile
    const domainToProfile: Record<string, string> = {
      immobilier: "immobilier",
      immo: "immobilier",
      garage: "garage_motrio",
      automobile: "garage_motrio",
      auto: "garage_motrio",
      restaurant: "restaurant",
      generic: "generic",
    };

    const profileId = domainToProfile[domain];
    if (profileId) {
      console.log(
        `[ProfileLoader] BOT_DOMAIN=${domain} → using profile '${profileId}'`,
      );
      return { profileId, source: "BOT_DOMAIN", domain };
    }
  }

  // No profile configured
  return { profileId: null, source: "none", domain: null };
}

// ── Load Current Profile ───────────────────────────────────────────────────

export function loadCurrentProfile(): AgentProfile | null {
  const { profileId, source } = resolveProfileId();

  if (!profileId) {
    console.warn(
      "[ProfileLoader] No profile configured. Set BOT_PROFILE or BOT_DOMAIN in .env",
    );
    return null;
  }

  const profile = loadProfileFromFile(profileId);

  if (profile) {
    console.log(
      `[ProfileLoader] Active profile: ${profile.name} (source: ${source})`,
    );
  } else {
    console.error(
      `[ProfileLoader] Failed to load profile '${profileId}' (source: ${source})`,
    );
  }

  return profile;
}

// ── Merge Profile with .env Overrides ──────────────────────────────────────

export function mergeProfileWithEnv(
  profile: AgentProfile,
): Record<string, string> {
  const merged: Record<string, string> = {};

  // 1. Start with profile branding
  merged.COMPANY_NAME = process.env.COMPANY_NAME || profile.branding.companyName;
  merged.COMPANY_TAGLINE =
    process.env.COMPANY_TAGLINE || profile.branding.companyTagline;
  merged.COMPANY_WEBSITE =
    process.env.COMPANY_WEBSITE || profile.branding.companyWebsite;
  merged.COMPANY_DESCRIPTION =
    process.env.COMPANY_DESCRIPTION || profile.branding.companyDescription;
  merged.COMPANY_SERVICES =
    process.env.COMPANY_SERVICES || profile.branding.companyServices;
  merged.TARGET_AUDIENCE =
    process.env.TARGET_AUDIENCE || profile.branding.targetAudience;

  // 2. Merge profile variables (VAR_*)
  for (const [key, value] of Object.entries(profile.variables)) {
    merged[key] = process.env[key] || value;
  }

  // 3. Knowledge base
  merged.KNOWLEDGE_URLS =
    process.env.KNOWLEDGE_URLS || profile.knowledgeBase.urls.join(",");
  merged.KNOWLEDGE_MAX_URLS =
    process.env.KNOWLEDGE_MAX_URLS ||
    String(profile.knowledgeBase.maxUrls || 3);
  merged.KNOWLEDGE_CACHE_TTL =
    process.env.KNOWLEDGE_CACHE_TTL ||
    String(profile.knowledgeBase.cacheTtl || 3600);

  // 4. Personality
  merged.FACTORY_WRITING_STYLE =
    process.env.FACTORY_WRITING_STYLE || profile.personality.writingStyle;
  merged.FACTORY_TONE = process.env.FACTORY_TONE || profile.personality.tone;
  merged.FACTORY_MAX_RESPONSE_WORDS =
    process.env.FACTORY_MAX_RESPONSE_WORDS ||
    String(profile.personality.maxResponseWords);

  // 5. Domain (critical!)
  merged.BOT_DOMAIN = profile.domain;

  // 6. CRM scoring
  merged.CRM_MIN_PUSH_SCORE =
    process.env.CRM_MIN_PUSH_SCORE ||
    String(profile.qualification.minPushScore);

  return merged;
}

// ── Get Profile-Aware Domain Contract ──────────────────────────────────────

export function getProfileDomain(): string {
  const profile = loadCurrentProfile();
  if (profile) {
    return profile.domain;
  }

  // Fallback to BOT_DOMAIN if no profile
  return (
    process.env.BOT_DOMAIN?.toLowerCase().trim() || "immobilier"
  ).toLowerCase();
}

// ── List Available Profiles ────────────────────────────────────────────────

export function listAvailableProfiles(): Array<{
  id: string;
  name: string;
  domain: string;
}> {
  const profilesDir = getProfilesDir();

  if (!fs.existsSync(profilesDir)) {
    return [];
  }

  const files = fs.readdirSync(profilesDir).filter((f) => f.endsWith(".json"));
  const profiles: Array<{ id: string; name: string; domain: string }> = [];

  for (const file of files) {
    if (file === "profile-schema.json") continue; // Skip schema

    try {
      const content = fs.readFileSync(path.join(profilesDir, file), "utf-8");
      const profile = JSON.parse(content);
      profiles.push({
        id: profile.id,
        name: profile.name,
        domain: profile.domain,
      });
    } catch {
      // Skip invalid profiles
    }
  }

  return profiles;
}

// ── Export Current Profile as JSON ─────────────────────────────────────────

export function exportCurrentConfig(): AgentProfile | null {
  return loadCurrentProfile();
}
