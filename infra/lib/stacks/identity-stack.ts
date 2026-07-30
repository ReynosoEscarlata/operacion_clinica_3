import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../../config/environments.js';

export interface IdentityStackProps extends StackProps {
  config: EnvironmentConfig;
}

// ADR-011: un unico Cognito user pool compartido para todos los roles,
// incluida plataforma (platform_admin/platform_support) y tenant
// (clinic_owner, clinic_admin, doctor, receptionist) — RFC-004. El paciente
// NO tiene cuenta (posesion de UUID, RFC-001 del Challenge 4), no aplica aqui.
export class IdentityStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);

    const { config } = props;
    const prefix = `clinica-${config.envName}`;

    // Stub: la logica real de leer tenant_id/rol del usuario e inyectarlos
    // como claims del JWT se implementa en la Fase 3/4, cuando exista el
    // modelo de datos de tenancy (RFC-003) y el motor de permisos
    // (packages/authz/, ADR-012). Aqui solo se aprovisiona el enganche.
    const preTokenGenerationFn = new lambda.Function(this, 'PreTokenGenerationFn', {
      functionName: `${prefix}-cognito-pre-token-generation`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(5),
      code: lambda.Code.fromInline(
        `exports.handler = async (event) => {
  // TODO (Fase 3/4): leer tenant_id y rol del usuario (RFC-003/RFC-004) e
  // inyectarlos en event.response.claimsOverrideDetails.claimsToAddOrOverride.
  // Placeholder intencional: no se inventa logica de negocio en la Fase 2
  // de infra pura.
  return event;
};`,
      ),
    });

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        fullname: { required: true, mutable: true },
      },
      customAttributes: {
        // ADR-005/RFC-003: tenant_id nullable a nivel de dato — en Cognito el
        // atributo custom simplemente no se setea para platform_admin/
        // platform_support (no hay "null" explicito, se omite el atributo).
        tenant_id: new cognito.StringAttribute({ mutable: true }),
        role: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      // MFA obligatorio para platform_admin/platform_support es la mitigacion
      // acordada en ADR-011 frente al riesgo de compartir pool con tenant —
      // se deja OPTIONAL a nivel de pool (Cognito no soporta "obligatorio solo
      // para ciertos usuarios" nativamente); forzarlo para roles de
      // plataforma especificamente es responsabilidad de la app (Fase 4).
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      lambdaTriggers: {
        preTokenGeneration: preTokenGenerationFn,
      },
      removalPolicy: config.removalPolicy,
    });

    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `${prefix}-gateway-client`,
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
      accessTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.days(30),
    });

    // Nota: RemovalPolicy.RETAIN en prod aplica tambien a la Lambda de
    // pre-token-generation por consistencia con el resto de la stack.
    if (config.removalPolicy === RemovalPolicy.RETAIN) {
      preTokenGenerationFn.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }
  }
}
