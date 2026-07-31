export { REQUEST_ID_HEADER, XRAY_TRACE_HEADER } from './headers.js';
export type { Logger } from './logger.js';
export { buildRequestMetricsEmf, emitRequestMetrics } from './emf.js';
export type { EmfDocument, EmitRequestMetricsInput } from './emf.js';
export { logAuthzDenied, logCrossTenantAccessDenied } from './security-events.js';
export type {
  AuthzDeniedEvent,
  CrossTenantAccessDeniedEvent,
  SecurityEventSeverity,
  SecurityEventType,
} from './security-events.js';
export { FULL_SAMPLING, configureSampling } from './xray.js';
export type { XraySamplingConfig } from './xray.js';
export { registerXray } from './xray-plugin.js';
export type { RegisterXrayOptions, XrayContext } from './xray-plugin.js';
