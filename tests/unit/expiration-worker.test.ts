import { describe, expect, it, vi } from 'vitest';

import { processExpirationJob } from '../../src/queues/workers/expiration.worker.js';

const buildLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('processExpirationJob', () => {
  it('cancela la cita si todavía está PENDING al expirar el TTL', async () => {
    const transition = vi.fn().mockResolvedValue({});
    const logger = buildLogger();

    await processExpirationJob(
      { appointmentId: 'apt-1' },
      {
        findStatusById: vi.fn().mockResolvedValue('PENDING'),
        stateMachine: { transition },
        logger,
      },
    );

    expect(transition).toHaveBeenCalledWith('apt-1', 'CANCELLED', {
      trigger: 'expiration',
      cancellationReason: 'No se completó el pago dentro de los 30 minutos',
    });
  });

  it('es idempotente: no hace nada si la cita ya avanzó de estado (ej. CONFIRMED)', async () => {
    const transition = vi.fn();
    const logger = buildLogger();

    await processExpirationJob(
      { appointmentId: 'apt-2' },
      {
        findStatusById: vi.fn().mockResolvedValue('CONFIRMED'),
        stateMachine: { transition },
        logger,
      },
    );

    expect(transition).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { appointmentId: 'apt-2', currentStatus: 'CONFIRMED' },
      'Job de expiración ignorado: la cita ya no está pendiente',
    );
  });

  it('no falla si la cita ya no existe (fue borrada por compensación de fallo de Stripe)', async () => {
    const transition = vi.fn();
    const logger = buildLogger();

    await processExpirationJob(
      { appointmentId: 'apt-3' },
      {
        findStatusById: vi.fn().mockResolvedValue(null),
        stateMachine: { transition },
        logger,
      },
    );

    expect(transition).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
