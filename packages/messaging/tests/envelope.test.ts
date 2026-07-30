import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  InvalidEnvelopeError,
  parseEnvelope,
  parseSystemJobEnvelope,
} from '../src/envelope.js';

const validRaw = (): Record<string, unknown> => ({
  eventId: randomUUID(),
  tenantId: randomUUID(),
  type: 'AppointmentCreated',
  payload: { appointmentId: randomUUID() },
  publishedAt: new Date().toISOString(),
});

describe('parseEnvelope', () => {
  it('acepta un envelope válido', () => {
    const raw = validRaw();
    const parsed = parseEnvelope(raw);
    expect(parsed).toEqual(raw);
  });

  it('rechaza un envelope sin tenantId', () => {
    const raw = validRaw();
    delete (raw as { tenantId?: unknown }).tenantId;
    expect(() => parseEnvelope(raw)).toThrow(InvalidEnvelopeError);
  });

  it('rechaza un envelope con tenantId no-uuid', () => {
    const raw = { ...validRaw(), tenantId: 'no-es-un-uuid' };
    expect(() => parseEnvelope(raw)).toThrow(InvalidEnvelopeError);
  });

  it('rechaza un envelope con type vacío', () => {
    const raw = { ...validRaw(), type: '' };
    expect(() => parseEnvelope(raw)).toThrow(InvalidEnvelopeError);
  });

  it('rechaza JSON que no es ni siquiera un objeto', () => {
    expect(() => parseEnvelope('no-es-un-objeto')).toThrow(InvalidEnvelopeError);
    expect(() => parseEnvelope(null)).toThrow(InvalidEnvelopeError);
    expect(() => parseEnvelope(undefined)).toThrow(InvalidEnvelopeError);
  });
});

describe('parseSystemJobEnvelope', () => {
  it('acepta un envelope de sistema (sin tenantId) con solo type', () => {
    const parsed = parseSystemJobEnvelope({ type: 'AppointmentNoShowScan' });
    expect(parsed).toEqual({ type: 'AppointmentNoShowScan' });
  });

  it('rechaza uno sin type', () => {
    expect(() => parseSystemJobEnvelope({})).toThrow(InvalidEnvelopeError);
  });
});
