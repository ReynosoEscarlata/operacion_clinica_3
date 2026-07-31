import type { AuthActor } from '@clinica/authz';

import { env } from '../../config/env.js';
import { AppError } from '../../lib/app-error.js';
import { signAccessToken } from '../../lib/jwt.js';
import type { Logger } from '../../lib/logger.js';
import type { SupportAccessGrantRepository } from './support-access.repository.js';

const DEFAULT_TTL_HOURS = 4;

export interface SupportAccessResult {
  accessToken: string;
  expiresIn: number;
  grantId: string;
}

// RFC-004, "Escalada de privilegios: acceso de soporte de plataforma". No
// es una fila de PERMISSION_MATRIX -- es infraestructura de la escalada en
// sí misma, así que el chequeo de rol es inline, no vía requirePermission().
export class SupportAccessService {
  constructor(
    private readonly repository: SupportAccessGrantRepository,
    private readonly logger: Logger,
  ) {}

  async grant(
    actor: AuthActor | undefined,
    tenantId: string,
    reason: string,
    ttlHours?: number,
  ): Promise<SupportAccessResult> {
    if (!actor || (actor.role !== 'platform_admin' && actor.role !== 'platform_support')) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Solo platform_admin/platform_support pueden solicitar acceso de soporte',
      );
    }

    const hours = ttlHours ?? DEFAULT_TTL_HOURS;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const grant = await this.repository.create({
      actorId: actor.sub,
      actorRole: actor.role,
      tenantId,
      reason,
      expiresAt,
    });

    this.logger.info(
      { grantId: grant.id, actorId: actor.sub, actorRole: actor.role, tenantId, expiresAt },
      'Acceso de soporte de plataforma concedido',
    );

    // JWT de elevación: mismo sub y rol del actor, pero tenantId = el del
    // grant (no null) -- desde acá el resto del flujo (gateway -> headers
    // -> authz-context -> requirePermission -> RLS) funciona sin ningún
    // cambio adicional, porque el request ya no tiene tenantId null. Vida
    // corta real: expira con el TTL normal del access token (900s por
    // default), siempre menor que ttlHours -- refrescarlo (POST
    // /v1/auth/refresh) NO preserva la elevación, vuelve al tenantId real
    // del usuario (null); hace falta un nuevo grant para seguir elevado.
    const accessToken = await signAccessToken({
      sub: actor.sub,
      role: actor.role,
      tenantId: grant.tenantId,
      doctorId: null,
      supportGrantId: grant.id,
    });

    return { accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, grantId: grant.id };
  }
}

export interface SupportAccessServiceDeps {
  repository: SupportAccessGrantRepository;
  logger: Logger;
}

export const buildSupportAccessService = (deps: SupportAccessServiceDeps): SupportAccessService =>
  new SupportAccessService(deps.repository, deps.logger);
