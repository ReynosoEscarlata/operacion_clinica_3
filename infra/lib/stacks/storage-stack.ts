import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';
import { SecureBucket } from '../constructs/secure-bucket.js';

export interface StorageStackProps extends StackProps {
  config: EnvironmentConfig;
}

export class StorageStack extends Stack {
  public readonly auditLogBucket: s3.IBucket;
  public readonly attachmentsBucket: s3.IBucket;
  public readonly backupsBucket: s3.IBucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;
    const prefix = `clinica-${config.envName}`;

    // ADR-013: audit log = tabla append-only por servicio + export periodico
    // a S3 con Object Lock en modo compliance. Object Lock en modo compliance
    // es irreversible incluso para root — es INCOMPATIBLE con
    // `autoDeleteObjects`/removal DESTROY (cdk destroy fallaria intentando
    // vaciar el bucket). Gate 2 de la Fase 2 exige que `cdk destroy` funcione
    // sin residuos en dev, asi que Object Lock compliance solo se activa en
    // staging/prod; dev usa un bucket seguro normal (mismo cifrado/TLS/
    // block-public-access) sin Object Lock, documentado explicitamente aqui
    // en vez de silenciarlo.
    if (config.envName === 'dev') {
      const auditLogDev = new SecureBucket(this, 'AuditLogBucket', {
        bucketName: `${prefix}-audit-log-export`,
        removalPolicy: config.removalPolicy,
      });
      this.auditLogBucket = auditLogDev.bucket;
    } else {
      const auditLogBucket = new s3.Bucket(this, 'AuditLogBucket', {
        bucketName: `${prefix}-audit-log-export`,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        versioned: true,
        objectLockEnabled: true,
        objectLockDefaultRetention: s3.ObjectLockRetention.compliance(Duration.days(365)),
        removalPolicy: RemovalPolicy.RETAIN,
      });
      this.auditLogBucket = auditLogBucket;
    }

    // Adjuntos de paciente: no existen hoy (confirmado en
    // docs/baseline-challenge-4.md seccion 3) — placeholder para cuando la
    // Fase 5 los introduzca. Prefijo obligatorio tenant/{id}/ se aplica via
    // bucket policy cuando exista logica de aplicacion que escriba aqui
    // (Fase 3), no hay nada que escribir todavia.
    const attachments = new SecureBucket(this, 'AttachmentsBucket', {
      bucketName: `${prefix}-attachments`,
      removalPolicy: config.removalPolicy,
    });
    this.attachmentsBucket = attachments.bucket;

    const backups = new SecureBucket(this, 'BackupsBucket', {
      bucketName: `${prefix}-backups`,
      removalPolicy: config.removalPolicy,
      lifecycleRules: [
        {
          id: 'expira-backups-viejos',
          transitions: [{ storageClass: s3.StorageClass.GLACIER, transitionAfter: Duration.days(30) }],
          expiration: config.envName === 'prod' ? undefined : Duration.days(90),
        },
      ],
    });
    this.backupsBucket = backups.bucket;
  }
}
