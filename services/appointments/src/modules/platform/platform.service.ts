import { getPlatformMetrics, type PlatformMetricsResult } from '../../lib/platform-metrics.js';
import type { PlatformDashboardStats, PlatformRepository } from './platform.repository.js';

export class PlatformService {
  constructor(private readonly repository: PlatformRepository) {}

  getDashboard(): Promise<PlatformDashboardStats> {
    return this.repository.getDashboardStats();
  }

  getMetrics(): Promise<PlatformMetricsResult> {
    return getPlatformMetrics();
  }
}

export interface PlatformServiceDeps {
  repository: PlatformRepository;
}

export const buildPlatformService = (deps: PlatformServiceDeps): PlatformService =>
  new PlatformService(deps.repository);
