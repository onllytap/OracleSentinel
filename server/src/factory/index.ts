// ============================================================================
// Factory Module — Public API
// ============================================================================

export type {
  AgentConfig,
  AgentBranding,
  AgentPersonality,
  CrmConfig,
  LlmConfig,
  KnowledgeConfig,
  SecurityConfig,
  DynamicVariables,
  RagConfig,
  FactoryBuildConfig,
  BuildResult,
  BuildStep,
  BuildAuditEntry,
  ReadinessReport,
  ReadinessCheck,
  ObservabilitySnapshot,
  RuntimeScenario,
  CrmFieldMapping,
} from "./types";

export {
  envToAgentConfig,
  agentConfigToEnv,
  loadCurrentConfig,
  saveConfig,
  diffConfigs,
  restoreLatestBackup,
  getLatestBackupPath,
} from "./config-synthesizer";
export { executeBuildPipeline } from "./build-pipeline";
export { runReadinessChecks } from "./readiness-gate";
export {
  getObservabilitySnapshot,
  metricsCollector,
  logBuffer,
  factoryLog,
} from "./observability";
export {
  RUNTIME_BEHAVIOR_MATRIX,
  getScenariosByOutcome,
  getBlockingScenarios,
} from "./runtime-matrix";
export {
  validateBody,
  validateQuery,
  validateParams,
  validateAgentConfig,
  coerceAgentConfig,
  schemas,
} from "./validation";
export type {
  ValidatedAgentConfig,
  ValidatedPutConfigBody,
  ValidatedPostBuildBody,
} from "./validation";
