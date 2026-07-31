import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { buildApp } from '../lib/build-app.js';

// Fase 6 (ADR-017): "una alarma sin runbook es ruido" -- este test convierte
// esa regla en una verificación real, no una promesa. Recorre TODAS las
// alarmas de CloudWatch de los stacks reales (mismo árbol que bin/infra.ts
// despliega, vía build-app.ts) y exige que:
// 1. El AlarmDescription siga el patrón mecánico que exige
//    infra/lib/constructs/alarm-with-runbook.ts.
// 2. El archivo referenciado exista en disco -- un runbook que no existe es
//    el mismo problema que una alarma sin runbook.
const RUNBOOK_PATTERN = /Runbook: docs\/runbooks\/([\w-]+\.md)/;

// infra/test -> infra -> raíz del repo -> docs/runbooks.
const RUNBOOKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'runbooks');

// Alarmas auto-generadas por CDK (ej. el "Upper threshold scaling alarm" de
// `scaleOnCpuUtilization`) no tienen `AlarmName` explícito -- no son
// alarmas operativas propias de este proyecto, así que quedan fuera del
// alcance de este test (no hay runbook razonable que escribir para una
// alarma interna del propio mecanismo de autoscaling).
const alarmsWithExplicitName = (
  template: Template,
): Array<{ alarmName: string; alarmDescription: string | undefined }> => {
  const alarms = template.findResources('AWS::CloudWatch::Alarm');
  return Object.values(alarms)
    .map((resource) => ({
      alarmName: resource.Properties?.AlarmName as string | undefined,
      alarmDescription: resource.Properties?.AlarmDescription as string | undefined,
    }))
    .filter((alarm): alarm is { alarmName: string; alarmDescription: string | undefined } =>
      Boolean(alarm.alarmName),
    );
};

describe('toda alarma de CloudWatch declara un runbook que existe en disco', () => {
  const app = buildApp('dev');
  const stacks = app.node.children.filter((child): child is Stack => child instanceof Stack);

  it('build-app.ts produjo al menos los 10 stacks esperados', () => {
    expect(stacks.length).toBeGreaterThanOrEqual(10);
  });

  for (const stack of stacks) {
    it(`${stack.stackName}: cada alarma con AlarmName tiene "Runbook: docs/runbooks/<archivo>.md" y el archivo existe`, () => {
      const template = Template.fromStack(stack);
      const alarms = alarmsWithExplicitName(template);

      for (const alarm of alarms) {
        expect(alarm.alarmDescription, `${alarm.alarmName} no tiene AlarmDescription`).toBeDefined();
        const match = alarm.alarmDescription?.match(RUNBOOK_PATTERN);
        expect(
          match,
          `${alarm.alarmName}: AlarmDescription "${alarm.alarmDescription}" no sigue el patrón "Runbook: docs/runbooks/<archivo>.md"`,
        ).not.toBeNull();

        const runbookFile = match?.[1] as string;
        const runbookPath = join(RUNBOOKS_DIR, runbookFile);
        expect(
          existsSync(runbookPath),
          `${alarm.alarmName}: el runbook referenciado docs/runbooks/${runbookFile} no existe en disco`,
        ).toBe(true);
      }
    });
  }
});
