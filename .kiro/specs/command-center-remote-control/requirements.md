# Requirements Document

## Introduction

OracleSentinel operates a fleet of lead-generation chatbots for roughly 350 real-estate agencies, pushing qualified leads into a CRM. A shadcn/React super-admin "Command Center" SPA (served at `/dashboard.html`, gated by an admin session cookie) already lets an operator **observe** the fleet: it reads live data from a Neon PostgreSQL database through existing admin endpoints (`/api/admin/db/overview`, `/api/admin/db/tenants`, `/api/admin/db/conversations`) and an infrastructure health endpoint (`/api/priv/infra`).

This feature (v2) turns the Command Center from an observation tool into a **remote control plane** for the fleet — controlling bots "de A à Z". The work is scoped to a single persona, the **super-admin Operator**, and is delivered in strict priority order:

1. **Remote bot control** — view and edit a per-agency bot configuration (system prompt, model, tone/temperature), save it, then restart/redeploy that bot remotely and confirm the change took effect.
2. **Deeper real-time supervision** — real per-bot metrics (message count, measured latency, response rate, last activity, hosting location) plus a live activity feed and recent per-agency logs.
3. **Security hardening** — resolve the known SSRF finding on the webhook tester, upgrade HIGH-severity dependencies, and enforce a **mandatory two-step login** (shared access key followed by a TOTP code from an authenticator app) backed by a new in-dashboard **Settings** area for security options. Per-user multi-user accounts remain a documented optional extension layered on top of this baseline.
4. **UI polish** — secondary refinements to presentation and interaction.

### Key Architectural Constraint

Today the "factory" configuration (`loadCurrentConfig` / `saveConfig`, `/api/factory/config`, `/api/factory/build`) is **global**: a single `AgentConfig` is persisted to one `.env` file and a build rewrites that file for the whole process, which serves all tenants through a `WIDGET_TENANT_MAP`. There is no separate process per agency. Remote per-agency control therefore requires introducing a **per-tenant configuration layer** that is stored, applied, and redeployed for one tenant without disrupting the others. Requirement 1 and Requirement 3 address this constraint explicitly. Some supervision metrics (measured latency/ping, response rate) do not exist yet and require **new instrumentation** (Requirement 7).

### Erratum (v2.1 — serving path)

The Introduction above describes the SPA as served at `/dashboard.html`. This is **obsolete**. The Command Center React SPA (`src/dashboard/CommandCenter.tsx`) is now built by the repo-root `npm run build` into `build/dashboard.html` and **served in production at `/qg`** (with a strict CSP), gated by the admin session. The lightweight `/priv` page is kept as a fallback. Likewise, some `/api/admin/db/*` paths cited in the Introduction are legacy; the fleet/supervision data now also flows through `/api/priv/*` (`overview`, `surveillance`, `infra`, `workers`). **The behavior described by Requirements 1–16 remains valid** — only the page URL and a few endpoint names have moved. New v2.1 work (Requirements 17–19) targets `/qg` and `/api/priv/*`.

## Glossary

- **Operator**: The authenticated super-admin human user who uses the Command Center. The only persona in scope.
- **Command_Center**: The super-admin SPA plus its backing API endpoints under `/api/admin`, `/api/priv`, and `/api/factory`.
- **Bot**: The logical lead-generation chatbot serving one agency. Identified by a Tenant_Id. In the current architecture all Bots are served by one shared server process, differentiated by tenant.
- **Tenant_Id**: The stable identifier of an agency/bot used as the partition key across the database (`catalog_properties`, `conversations`, `messages`, `leads`).
- **Global_Config**: The single process-wide `AgentConfig` persisted to `.env` via the existing factory module.
- **Tenant_Config**: A per-Tenant_Id configuration record (system prompt, model, tone, temperature, and other overridable parameters) that overrides Global_Config defaults for one Bot.
- **Tenant_Config_Store**: The persistence layer (Neon PostgreSQL) that stores Tenant_Config records and their version history.
- **Effective_Config**: The configuration actually used by a Bot at runtime, computed by layering a Tenant_Config over the Global_Config defaults.
- **Redeploy**: The operation that makes a saved Tenant_Config become the Effective_Config for one Bot and reloads the runtime so the Bot uses it.
- **Redeploy_Status**: The lifecycle state of a Redeploy: `pending`, `in_progress`, `succeeded`, `failed`, or `rolled_back`.
- **Config_Version**: A monotonically increasing integer (or equivalent ordered token) assigned to each saved Tenant_Config revision, used for confirmation and rollback.
- **Metrics_Collector**: The new instrumentation component that records and exposes real per-Bot metrics.
- **Bot_Metrics**: The per-Bot measurements: message_count, measured_latency_ms, response_rate, last_activity_at, and hosting_location.
- **Response_Rate**: The proportion of inbound user messages in a measurement window that received a Bot reply, expressed as a percentage from 0 to 100.
- **Measured_Latency_Ms**: The round-trip time in milliseconds of an active health probe issued to a Bot's serving endpoint, replacing the current pseudo/hash-derived ping.
- **Activity_Feed**: The time-ordered stream of recent fleet events (conversations started, leads captured, config changes, redeploys, errors) presented to the Operator.
- **Bot_Logs**: Recent structured log entries scoped to a single Tenant_Id.
- **Webhook_Tester**: The existing `POST /api/factory/test/webhook` endpoint that probes operator-supplied webhook URLs.
- **Auth_Service**: The component that authenticates Operators. The baseline mechanism is a mandatory Two_Step_Login: a shared `ADMIN_API_KEY` access key followed by a TOTP code, exchanged for an HttpOnly signed session cookie with CSRF protection.
- **Access_Key**: The shared secret value held in the `ADMIN_API_KEY` environment variable that the Operator enters in the first step of the Two_Step_Login.
- **TOTP**: A time-based one-time password as defined by RFC 6238, generated by an Authenticator_App such as Google Authenticator.
- **Authenticator_App**: A client application controlled by the Operator that generates TOTP codes from a TOTP_Secret.
- **TOTP_Secret**: The per-instance shared secret from which TOTP codes are derived, stored only on the server side.
- **TOTP_Enrollment**: The process by which the Operator configures and activates a TOTP_Secret for the Command_Center, including verifying a generated TOTP code.
- **Otpauth_URI**: The `otpauth://totp/...` provisioning string (renderable as a QR code) that an Authenticator_App imports to register a TOTP_Secret.
- **Two_Step_Login**: The mandatory authentication flow that requires a valid Access_Key followed by a valid TOTP code before an Admin_Session is established.
- **Recovery_Code**: A single-use backup code, issued at TOTP_Enrollment, that may be substituted for a TOTP code to complete a Two_Step_Login.
- **Break_Glass**: An explicit, environment-configured emergency mechanism that allows an Admin_Session to be established without a TOTP code when configured.
- **Settings_Area**: The dashboard area, labelled "Settings" / "Paramètres", that hosts security options including TOTP_Enrollment management and is the extensible container for additional security settings.
- **Admin_Session**: The authenticated, CSRF-protected session required to call mutating Command_Center endpoints.
- **Audit_Log**: A persisted, append-only record of Operator actions (config edits, redeploys, rollbacks, auth events).
- **Tenant_CRM_Config**: A per-Tenant_Id record describing how that agency's qualified leads are pushed to its own CRM: the Crm_Provider, an enabled flag, the encrypted provider credentials, and a field mapping. Secrets are stored encrypted and never returned by any API.
- **Crm_Provider**: The destination CRM type for a Tenant_CRM_Config, one of `none`, `twenty`, `airtable`, or `webhook` (a generic signed HTTP endpoint).
- **Plan**: A commercial tier (`starter`, `pro`, `scale`) with a configurable monthly price and a set of Quotas, assigned to a Tenant.
- **Usage_Event**: A metered unit of consumption recorded per Tenant_Id (kind ∈ message, lead, conversation; with a quantity and timestamp) used for billing and quota accounting. Only recorded when billing is enabled.
- **Quota**: The maximum allowed quantity of a metered kind for a Plan over a billing period; exceeding it puts the Tenant in an over-quota state.
- **Subscription**: The billing relationship between a Tenant and Stripe (customer id, subscription id, plan, status, current period end), updated by verified Stripe webhooks.
- **Provisioning**: The super-admin operation that creates a new Tenant (name, plan, status), generates its Widget_Id, and returns its Embed_Snippet.
- **Embed_Snippet**: The copyable HTML/script snippet an agency pastes on its site to load its widget, parameterized by the Tenant's Widget_Id.
- **Widget_Id**: The stable public identifier minted at Provisioning that maps an embedded widget to its Tenant_Id (via the widget auth), distinct from any secret.

## Requirements

### Requirement 1: View and edit a per-agency bot configuration

**User Story:** As an Operator, I want to view and edit the configuration of an individual agency's bot, so that I can tune one bot's behavior without affecting the other agencies.

#### Acceptance Criteria

1. WHEN the Operator opens a Bot's configuration view for a Tenant_Id, THE Command_Center SHALL display the Effective_Config for that Tenant_Id, including the system prompt, model, tone, and temperature.
2. WHERE no Tenant_Config exists for the requested Tenant_Id, THE Command_Center SHALL display the Global_Config default values and SHALL indicate that the values are inherited defaults.
3. WHEN the Command_Center returns a Bot's configuration, THE Command_Center SHALL exclude secret values (API keys, tokens, passwords) from the response.
4. THE Command_Center SHALL allow the Operator to edit the system prompt, model, tone, and temperature fields of a Tenant_Config.
5. WHEN the Operator submits an edited Tenant_Config, THE Command_Center SHALL validate that temperature is a number within the inclusive range 0 to 2.
6. WHEN the Operator submits an edited Tenant_Config, THE Command_Center SHALL validate that the selected model is one of the models the configured LLM provider supports.
7. IF a submitted Tenant_Config field fails validation, THEN THE Command_Center SHALL reject the submission and SHALL return a field-level description of each validation failure.
8. WHILE the Operator has unsaved edits in the configuration view, THE Command_Center SHALL indicate that pending changes have not been saved.

### Requirement 2: Persist per-tenant configuration without affecting other tenants

**User Story:** As an Operator, I want each agency's configuration stored separately, so that saving one bot's settings never changes another bot's behavior.

#### Acceptance Criteria

1. WHEN the Operator saves a valid Tenant_Config for a Tenant_Id, THE Tenant_Config_Store SHALL persist the Tenant_Config associated with that Tenant_Id.
2. WHEN the Tenant_Config_Store persists a Tenant_Config, THE Tenant_Config_Store SHALL assign a new Config_Version greater than all prior Config_Versions for that Tenant_Id.
3. WHEN the Tenant_Config_Store persists a Tenant_Config for one Tenant_Id, THE Tenant_Config_Store SHALL leave the persisted Tenant_Config of every other Tenant_Id unchanged.
4. WHEN a Tenant_Config is saved, THE Tenant_Config_Store SHALL retain the previously saved Config_Version for that Tenant_Id to support rollback.
5. FOR ALL valid Tenant_Config records, saving a Tenant_Config and then loading the Tenant_Config for the same Tenant_Id SHALL return values equal to the saved non-secret values (round-trip property).
6. WHEN the Command_Center computes an Effective_Config, THE Command_Center SHALL apply the Tenant_Config values over the Global_Config defaults such that every field not set in the Tenant_Config takes the Global_Config value.
7. IF the Tenant_Config_Store is unreachable when a save is attempted, THEN THE Command_Center SHALL reject the save and SHALL report that the configuration was not persisted.

### Requirement 3: Remotely restart and redeploy a single bot safely

**User Story:** As an Operator, I want to restart/redeploy one agency's bot after editing its configuration, so that my changes take effect remotely and safely without disrupting the rest of the fleet.

#### Acceptance Criteria

1. WHEN the Operator requests a Redeploy for a Tenant_Id, THE Command_Center SHALL apply the latest saved Config_Version for that Tenant_Id as the Effective_Config for that Bot.
2. WHEN a Redeploy begins, THE Command_Center SHALL set the Redeploy_Status to `in_progress` and SHALL record the Config_Version being deployed.
3. WHILE a Redeploy is `in_progress` for a Tenant_Id, THE Command_Center SHALL reject a second Redeploy request for the same Tenant_Id and SHALL report that a Redeploy is already running.
4. WHEN a Redeploy completes successfully, THE Command_Center SHALL set the Redeploy_Status to `succeeded` and SHALL record the deployed Config_Version and completion timestamp.
5. WHEN a Redeploy for one Tenant_Id is applied, THE Command_Center SHALL leave the Effective_Config of every other Tenant_Id unchanged.
6. IF a Redeploy fails before completion, THEN THE Command_Center SHALL restore the previously deployed Config_Version for that Tenant_Id and SHALL set the Redeploy_Status to `rolled_back`.
7. WHEN a Redeploy request is received, THE Command_Center SHALL require an Admin_Session and a valid CSRF token before performing the Redeploy.
8. WHEN the Operator initiates a Redeploy, THE Command_Center SHALL require an explicit confirmation step before the Redeploy begins.

### Requirement 4: Confirm that a deployed configuration change took effect

**User Story:** As an Operator, I want to confirm that the bot is actually running my new configuration, so that I know the remote change succeeded rather than assuming it did.

#### Acceptance Criteria

1. WHEN a Redeploy reaches `succeeded`, THE Command_Center SHALL report the Config_Version currently active for that Tenant_Id.
2. WHEN the Operator requests the active configuration state of a Bot, THE Command_Center SHALL return the Config_Version that the Bot is currently serving.
3. IF the active Config_Version for a Tenant_Id differs from the latest saved Config_Version, THEN THE Command_Center SHALL indicate that the Bot is running an out-of-date configuration.
4. WHEN a Redeploy succeeds, THE Command_Center SHALL present a confirmation to the Operator that includes the Tenant_Id and the now-active Config_Version.
5. IF reporting the active Config_Version fails after a Redeploy has applied the configuration, THEN THE Command_Center SHALL keep the Redeploy_Status as `succeeded`.

### Requirement 5: Audit all remote control actions

**User Story:** As an Operator, I want every configuration change and redeploy recorded, so that I can review who changed what and recover from mistakes.

#### Acceptance Criteria

1. WHEN the Operator saves a Tenant_Config, THE Command_Center SHALL append an Audit_Log entry containing the Tenant_Id, the new Config_Version, and the action timestamp.
2. WHEN the Operator initiates a Redeploy, THE Command_Center SHALL append an Audit_Log entry recording the Tenant_Id and the targeted Config_Version at initiation, regardless of whether the Redeploy later succeeds or fails, and SHALL update that entry with the final Redeploy_Status.
3. WHEN the Operator performs a rollback, THE Command_Center SHALL append an Audit_Log entry containing the Tenant_Id and the Config_Version restored.
4. THE Audit_Log SHALL store entries in append-only order such that existing entries are not modified by later actions.
5. WHEN the Command_Center writes an Audit_Log entry, THE Command_Center SHALL exclude secret values from the entry.
6. WHEN an authentication event occurs (a completed Two_Step_Login, a failed Access_Key attempt, a failed TOTP attempt, a TOTP_Enrollment activation, a TOTP reset or disable, or a Break_Glass use), THE Command_Center SHALL append an Audit_Log entry recording the event type and timestamp without recording the Access_Key, TOTP_Secret, TOTP code, or Recovery_Code values.

### Requirement 6: Real per-bot metrics

**User Story:** As an Operator, I want real measured metrics for each bot, so that supervision reflects actual runtime behavior instead of placeholder values.

#### Acceptance Criteria

1. WHEN the Operator requests Bot_Metrics for a Tenant_Id, THE Command_Center SHALL return the message_count, Measured_Latency_Ms, Response_Rate, last_activity_at, and hosting_location for that Tenant_Id.
2. THE Metrics_Collector SHALL compute message_count for a Tenant_Id from the persisted `messages` data partitioned by that Tenant_Id.
3. THE Metrics_Collector SHALL compute Response_Rate for a Tenant_Id as the percentage of inbound user messages in the measurement window that received a Bot reply, bounded to the inclusive range 0 to 100.
4. WHEN the Metrics_Collector reports Measured_Latency_Ms, THE Metrics_Collector SHALL use the result of an active health probe to the Bot's serving endpoint rather than a value derived from the Tenant_Id.
5. IF a Measured_Latency_Ms probe does not complete within its configured timeout, THEN THE Metrics_Collector SHALL report the latency as unavailable for that Tenant_Id, regardless of any other latency data available.
6. WHERE a Tenant_Id has no recorded activity, THE Command_Center SHALL report last_activity_at as none rather than a fabricated value.
7. THE Command_Center SHALL report hosting_location for a Tenant_Id using the serving infrastructure metadata without exposing secret connection values.

### Requirement 7: Replace pseudo ping with measured latency instrumentation

**User Story:** As an Operator, I want the surveillance wall to show measured latency, so that the "live" indicators reflect reachability instead of a hash of the bot name.

#### Acceptance Criteria

1. THE Metrics_Collector SHALL provide a measured latency value derived from an active probe for each displayed Bot.
2. WHEN the surveillance view renders a Bot tile, THE Command_Center SHALL display the Measured_Latency_Ms value provided by the Metrics_Collector.
3. WHEN a Bot's latest health probe fails, THE Command_Center SHALL render that Bot as unreachable in the surveillance view.
4. THE Metrics_Collector SHALL time-box each latency probe so that an unresponsive Bot does not delay the metrics response beyond the configured timeout.
5. WHEN the Operator refreshes the surveillance view, THE Command_Center SHALL present latency and reachability values from a probe performed within the configured freshness window.

### Requirement 8: Live activity feed and recent per-agency logs

**User Story:** As an Operator, I want a live activity feed and recent logs per agency, so that I can supervise what each bot is doing in near real time.

#### Acceptance Criteria

1. WHEN the Operator opens the Activity_Feed, THE Command_Center SHALL display recent fleet events ordered from most recent to least recent.
2. THE Activity_Feed SHALL include events for conversation start, lead capture, Tenant_Config save, Redeploy, and Bot error.
3. WHEN a new qualifying event occurs while the Activity_Feed is open, THE Command_Center SHALL add the event to the Activity_Feed within the configured refresh interval.
4. WHEN the Operator requests Bot_Logs for a Tenant_Id, THE Command_Center SHALL return recent log entries scoped to that Tenant_Id ordered from most recent to least recent.
5. WHEN the Command_Center returns Activity_Feed events or Bot_Logs, THE Command_Center SHALL exclude secret values from the returned entries.
6. WHEN the Operator filters the Activity_Feed by Tenant_Id, THE Command_Center SHALL display only events associated with that Tenant_Id.

### Requirement 9: Resolve the webhook tester SSRF finding

**User Story:** As an Operator, I want the webhook tester to be safe against server-side request forgery, so that probing a URL cannot be abused to reach internal systems.

#### Acceptance Criteria

1. WHEN the Webhook_Tester receives a target URL, THE Webhook_Tester SHALL reject the request unless the URL scheme is `http` or `https`.
2. WHEN the Webhook_Tester resolves a target hostname, THE Webhook_Tester SHALL reject the request IF any resolved address is a loopback, private, link-local, or otherwise non-routable address.
3. WHEN the Webhook_Tester probes a target URL, THE Webhook_Tester SHALL NOT follow HTTP redirects to a different host.
4. THE feature SHALL resolve the recorded SSRF finding on the Webhook_Tester by either a documented `.snyk` ignore with a stated justification or a strict destination allowlist enforced at request time.
5. WHERE a strict allowlist is enforced, THE Webhook_Tester SHALL reject any target URL whose host is not present on the allowlist.

### Requirement 10: Upgrade HIGH-severity vulnerable dependencies

**User Story:** As an Operator, I want known HIGH-severity dependency vulnerabilities removed, so that the platform is not exposed to documented exploits.

#### Acceptance Criteria

1. THE feature SHALL upgrade every dependency that a security scan reports at HIGH severity to a version with no reported HIGH-severity vulnerability.
2. WHEN a HIGH-severity dependency vulnerability has no available non-vulnerable upgrade, THE feature SHALL record a documented justification for retaining the dependency.
3. WHEN dependency upgrades are completed, THE project build and existing automated tests SHALL pass.
4. IF a dependency upgrade causes the project build or an existing automated test to fail, THEN THE feature SHALL roll back that upgrade to the last state in which the build and tests passed.

### Requirement 11: Mandatory two-step login (access key plus TOTP)

**User Story:** As an Operator, I want every Command Center login to require both the shared access key and a TOTP code from my authenticator app, so that a leaked access key alone cannot grant control of the fleet.

#### Acceptance Criteria

1. WHEN the Operator submits an Access_Key, THE Auth_Service SHALL compare the submitted value against the configured `ADMIN_API_KEY` using a constant-time comparison and SHALL reject the submission IF the values are not equal.
2. WHEN a submitted Access_Key is valid and a TOTP_Secret is enrolled, THE Auth_Service SHALL require a valid TOTP code as a second step before establishing an Admin_Session.
3. IF only a valid Access_Key is provided and no valid TOTP code or valid Recovery_Code is provided, THEN THE Auth_Service SHALL NOT establish an Admin_Session.
4. WHEN the Operator submits a TOTP code in the second step, THE Auth_Service SHALL accept the code only IF the code matches the enrolled TOTP_Secret within the RFC 6238 verification window configured for the Auth_Service.
5. WHEN a valid Access_Key and a valid TOTP code are both provided, THE Auth_Service SHALL establish an Admin_Session as an HttpOnly signed session cookie with a CSRF token.
6. IF the submitted TOTP code does not match within the configured verification window, THEN THE Auth_Service SHALL deny the Admin_Session, SHALL append a failed-attempt entry to the Audit_Log, and SHALL leave any existing Admin_Session unchanged.
7. WHEN the count of consecutive failed second-step attempts for the Auth_Service reaches the configured attempt limit, THE Auth_Service SHALL reject further TOTP submissions until the configured lockout interval has elapsed.
8. IF a request fails an active security control (for example a revoked Access_Key or an exceeded attempt limit), THEN THE Auth_Service SHALL deny the Admin_Session even when a valid Access_Key is presented.

### Requirement 12: First-time TOTP enrollment via the Settings area

**User Story:** As an Operator, I want to enroll my authenticator app the first time I sign in, so that I can complete the mandatory two-step login from then on.

#### Acceptance Criteria

1. IF a valid Access_Key is submitted WHILE no TOTP_Secret is enrolled, THEN THE Auth_Service SHALL NOT complete a normal Two_Step_Login and SHALL direct the Operator into the TOTP_Enrollment flow.
2. WHEN the TOTP_Enrollment flow begins, THE Command_Center SHALL generate a TOTP_Secret and SHALL present the TOTP_Secret together with its Otpauth_URI to the Operator for import into an Authenticator_App.
3. WHEN the Operator submits a TOTP code during TOTP_Enrollment, THE Command_Center SHALL activate the TOTP_Secret only IF the submitted code matches the generated TOTP_Secret within the configured verification window.
4. IF the verification code submitted during TOTP_Enrollment does not match, THEN THE Command_Center SHALL reject the activation and SHALL NOT establish an Admin_Session.
5. WHEN TOTP_Enrollment is activated, THE Command_Center SHALL issue a set of single-use Recovery_Codes to the Operator one time.
6. WHEN TOTP_Enrollment is activated, THE Command_Center SHALL require a valid TOTP code in addition to the Access_Key for every subsequent login.
7. THE Command_Center SHALL host the TOTP_Enrollment and management controls within the Settings_Area of the dashboard.

### Requirement 13: Settings area for security options

**User Story:** As an Operator, I want a Settings area in the dashboard that groups security options, so that I can manage two-step login and other protections from one place and add more options over time.

#### Acceptance Criteria

1. WHEN the Operator opens the Settings_Area, THE Command_Center SHALL require an active Admin_Session before displaying any security option.
2. THE Settings_Area SHALL present the current TOTP_Enrollment status as either enrolled or not enrolled.
3. THE Settings_Area SHALL allow the Operator to set up TOTP when no TOTP_Secret is enrolled and to reset or disable TOTP when a TOTP_Secret is enrolled.
4. WHEN the Operator resets or disables an enrolled TOTP_Secret, THE Command_Center SHALL require a valid CSRF token and a re-verification step (a current TOTP code or a valid Recovery_Code) before applying the change.
5. THE Settings_Area SHALL present the following additional security settings: the rate-limit IP allowlist in effect, the Admin_Session timeout, access to the Audit_Log, and the key-rotation guidance for the Access_Key.
6. THE Settings_Area SHALL organize security options as a list of independent option entries such that an additional security option can be added without altering the behavior of existing options.
7. WHEN the Command_Center renders any Settings_Area option, THE Command_Center SHALL exclude secret values, including the TOTP_Secret and the Access_Key, from the rendered content.

### Requirement 14: TOTP secret protection and recovery safeguards

**User Story:** As an Operator, I want the TOTP secret stored safely and a controlled recovery path, so that mandatory two-step login does not lock me out and the secret is never exposed.

#### Acceptance Criteria

1. WHEN a TOTP_Secret is persisted, THE Command_Center SHALL store the TOTP_Secret only on the server side and SHALL NOT include the TOTP_Secret in any API response after TOTP_Enrollment is activated.
2. WHEN TOTP_Enrollment returns the TOTP_Secret and Otpauth_URI during the enrollment step, THE Command_Center SHALL return those values only within the active enrollment exchange and SHALL NOT return them again afterward.
3. WHEN the Operator submits a Recovery_Code in place of a TOTP code, THE Auth_Service SHALL accept the Recovery_Code only IF the code is unused and matches an issued Recovery_Code, and SHALL mark that Recovery_Code as used once consumed.
4. WHERE a Break_Glass mechanism is configured, THE Auth_Service SHALL allow an Admin_Session to be established without a TOTP code only when the configured Break_Glass value is presented, and SHALL append a Break_Glass use entry to the Audit_Log.
5. WHERE no Break_Glass mechanism is configured and no Recovery_Code remains unused, THE Auth_Service SHALL require a valid TOTP code to complete a Two_Step_Login.
6. IF a Recovery_Code submission does not match an unused issued Recovery_Code, THEN THE Auth_Service SHALL deny the Admin_Session and SHALL append a failed-attempt entry to the Audit_Log.

### Requirement 15: Optional multi-user authentication extension

**User Story:** As an Operator, I want the option to extend the baseline two-step login to per-user accounts, so that fleet control can later be tied to individual identities rather than one shared key.

#### Acceptance Criteria

1. WHERE multi-user authentication is enabled, THE Auth_Service SHALL require a valid per-user credential in place of the shared Access_Key before the TOTP step.
2. WHERE multi-user authentication is enabled, THE Auth_Service SHALL require a successful TOTP verification before establishing an Admin_Session.
3. WHERE multi-user authentication is enabled, THE Audit_Log SHALL record the authenticated user identity for each remote control action.
4. WHERE multi-user authentication is disabled, THE Auth_Service SHALL use the shared Access_Key plus TOTP Two_Step_Login as the baseline mechanism.
5. IF TOTP verification fails under multi-user authentication, THEN THE Auth_Service SHALL deny the Admin_Session and SHALL record the failed attempt in the Audit_Log.

### Requirement 16: UI polish

**User Story:** As an Operator, I want a clear and consistent control interface, so that the new control and supervision capabilities are easy to use.

#### Acceptance Criteria

1. WHILE a Redeploy is `in_progress`, THE Command_Center SHALL display an in-progress indicator for the affected Bot.
2. WHEN an Operator action fails, THE Command_Center SHALL display a human-readable error message describing the failure.
3. WHEN the Operator views a Bot whose active Config_Version is out of date, THE Command_Center SHALL display a visible out-of-date indicator.
4. THE Command_Center SHALL present configuration, control, and supervision actions using consistent labels and iconography across the Chatbots and Surveillance views.

### Requirement 17: Push leads to each agency's own CRM (encrypted)

**User Story:** As an Operator, I want each agency's qualified leads pushed into that agency's own CRM, so that every client receives its leads where it already works.

#### Acceptance Criteria

1. THE Tenant_CRM_Config SHALL support a Crm_Provider in the set `{none, twenty, airtable, webhook}` per Tenant_Id.
2. WHEN the Operator saves provider credentials for a Tenant_CRM_Config, THE Command_Center SHALL store them encrypted with AES-256-GCM derived from `APP_ENCRYPTION_KEY` and SHALL NOT persist them in cleartext.
3. WHEN the Command_Center returns a Tenant_CRM_Config, THE Command_Center SHALL exclude every secret value (API keys, tokens, webhook secrets) from the response.
4. THE Tenant_CRM_Config SHALL provide a configurable field mapping from the canonical fields (firstName, lastName, phone, email, need, qualification, notes) to the Crm_Provider's fields.
5. WHEN the Operator runs a connection test for a Tenant_CRM_Config, THE Command_Center SHALL return only a success/failure result and a non-secret message.
6. WHEN a qualified lead is captured for a Tenant_Id whose Tenant_CRM_Config is enabled, THE Command_Center SHALL push the lead to that tenant's CRM using its configured field mapping.
7. WHERE no enabled Tenant_CRM_Config exists for a Tenant_Id, THE Command_Center SHALL fall back to the existing global CRM behavior unchanged.
8. IF a per-tenant CRM push fails, THEN THE Command_Center SHALL append a PII-safe Audit_Log entry and SHALL NOT crash the chat.
9. IF the system runs in production without `APP_ENCRYPTION_KEY` configured, THEN THE Command_Center SHALL refuse to handle CRM secrets and SHALL NOT store them in cleartext.

### Requirement 18: Billing and quotas (Stripe), fully disableable

**User Story:** As an Operator, I want optional usage-based billing with quotas, so that the platform can be sold by subscription without changing anything when billing is turned off.

#### Acceptance Criteria

1. THE Command_Center SHALL define three Plans (`starter`, `pro`, `scale`), each with a configurable monthly price and configurable Quotas.
2. WHERE `BILLING_ENABLED` is false, THE Command_Center SHALL operate fully without metering, paywall, or Stripe calls, with no change to existing behavior.
3. WHERE `BILLING_ENABLED` is true, THE Command_Center SHALL record Usage_Events (messages, leads, conversations) per Tenant_Id.
4. WHEN a Tenant exceeds its Quota, THE Command_Center SHALL return a clear paywall response and SHALL expose an over-quota state to the QG.
5. WHEN a Stripe webhook request is received, THE Command_Center SHALL verify its signature against `STRIPE_WEBHOOK_SECRET` on a public raw-body route and SHALL update the Subscription status accordingly.
6. WHEN the Operator views a Tenant, THE Command_Center SHALL display that Tenant's plan, Subscription status, and usage versus Quota.
7. WHEN the Command_Center renders any billing information, THE Command_Center SHALL exclude secret keys and SHALL append an Audit_Log entry for billing changes.

### Requirement 19: Agency provisioning by the super-admin

**User Story:** As an Operator, I want to provision a new agency in one action and get a ready-to-paste embed snippet, so that onboarding a client is fast and its lifecycle is controllable.

#### Acceptance Criteria

1. WHEN the Operator provisions an agency, THE Command_Center SHALL create a Tenant (name, plan, status `active`) and SHALL generate a unique Widget_Id.
2. WHEN an agency has been provisioned, THE Command_Center SHALL return a copyable Embed_Snippet together with the per-tenant widget authentication mapping.
3. THE Tenant status SHALL be one of `{active, suspended, archived}`.
4. WHERE a Tenant status is `suspended` or `archived`, THE Bot SHALL stop serving that Tenant and SHALL return a disabled response.
5. WHEN the Operator suspends, reactivates, or archives a Tenant, THE Command_Center SHALL require an Admin_Session and a valid CSRF token and SHALL append an Audit_Log entry.
6. WHEN the Operator lists agencies, THE Command_Center SHALL display each agency's status, plan, owning client, and Widget_Id without exposing any secret.
7. THE Command_Center SHALL restrict Provisioning to the super-admin Operator; self-serve sign-up is out of scope and per-user identities are covered by Requirement 15.
