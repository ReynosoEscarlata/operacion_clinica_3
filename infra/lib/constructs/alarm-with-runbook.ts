import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

export interface AlarmWithRunbookProps extends cloudwatch.AlarmProps {
  // Nombre de archivo bajo docs/runbooks/ (sin el prefijo de carpeta) -- ej.
  // "alarma-dlq-no-vacia.md". Obligatorio: "una alarma sin runbook es
  // ruido" (DoD de Fase 6, ADR-017). infra/test/alarmas-tienen-runbook.test.ts
  // verifica que el patrón generado abajo aparezca en `AlarmDescription` Y
  // que el archivo exista en disco -- este construct por sí solo no puede
  // validar el filesystem (correría en tiempo de síntesis de cada stack,
  // no en un test), por eso la responsabilidad se separa así.
  runbook: string;
}

// Envoltorio de cloudwatch.Alarm que exige el prop `runbook` y lo
// materializa en `alarmDescription` con un patrón mecánico (no aspiracional):
// "Runbook: docs/runbooks/<archivo>.md — <descripción original>". Migra las
// alarmas ya existentes desde Fase 2 (HighCpu, unhealthy-targets, DLQ) a
// este construct en vez de dejarlas con el `cloudwatch.Alarm` plano.
export class AlarmWithRunbook extends Construct {
  public readonly alarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: AlarmWithRunbookProps) {
    super(scope, id);

    const { runbook, alarmDescription, ...alarmProps } = props;

    this.alarm = new cloudwatch.Alarm(this, 'Alarm', {
      ...alarmProps,
      alarmDescription: `Runbook: docs/runbooks/${runbook} — ${alarmDescription ?? props.alarmName ?? 'ver runbook'}`,
    });
  }
}
