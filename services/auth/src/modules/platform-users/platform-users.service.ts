import type { PlatformUsersRepository } from './platform-users.repository.js';

export class PlatformUsersService {
  constructor(private readonly repository: PlatformUsersRepository) {}

  getActiveUserCounts(): Promise<Record<string, number>> {
    return this.repository.getActiveUserCounts();
  }
}

export interface PlatformUsersServiceDeps {
  repository: PlatformUsersRepository;
}

export const buildPlatformUsersService = (deps: PlatformUsersServiceDeps): PlatformUsersService =>
  new PlatformUsersService(deps.repository);
