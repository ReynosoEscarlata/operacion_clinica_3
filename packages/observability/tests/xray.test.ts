import { describe, expect, it } from 'vitest';

import { formatTraceHeader } from '../src/xray.js';

describe('formatTraceHeader', () => {
  it('arma el header X-Amzn-Trace-Id con Root/Parent/Sampled=1 para un segmento trazado', () => {
    const header = formatTraceHeader({ trace_id: '1-abc-def', id: 'seg-1' });
    expect(header).toBe('Root=1-abc-def;Parent=seg-1;Sampled=1');
  });

  it('usa Sampled=0 cuando el segmento no fue trazado', () => {
    const header = formatTraceHeader({ trace_id: '1-abc-def', id: 'seg-1', notTraced: true });
    expect(header).toBe('Root=1-abc-def;Parent=seg-1;Sampled=0');
  });
});
