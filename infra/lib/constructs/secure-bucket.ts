import { RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface SecureBucketProps {
  bucketName: string;
  removalPolicy: RemovalPolicy;
  versioned?: boolean;
  lifecycleRules?: s3.LifecycleRule[];
}

// Construct reutilizable: cifrado, versionado, block public access y TLS
// obligatorio por politica — los 4 requisitos no negociables de "todo bucket
// S3" del plan maestro Fase 2, para no repetirlos por bucket (mismo espiritu
// que ClinicService para Fargate).
export class SecureBucket extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SecureBucketProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: props.bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: props.versioned ?? true,
      removalPolicy: props.removalPolicy,
      autoDeleteObjects: props.removalPolicy === RemovalPolicy.DESTROY,
      lifecycleRules: props.lifecycleRules,
    });
  }
}
