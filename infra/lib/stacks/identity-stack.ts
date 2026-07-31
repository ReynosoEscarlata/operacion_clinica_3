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

    // Fase 4 (RFC-004/RFC-003/ADR-012): lee los atributos custom del usuario
    // (poblados al aprovisionar la cuenta, fuera del alcance de este stack)
    // y los inyecta como claims del JWT -- mismo shape que
    // services/auth/src/lib/jwt.ts firma localmente hoy (role/tenant_id/
    // doctor_id en snake_case, formato @clinica/authz), para que el
    // gateway (gateway/src/middleware/verify-jwt.ts) no necesite distinguir
    // si el JWT vino de Cognito o del emisor local el día que se migre.
    // Solo infra: services/auth NO consume Cognito todavía (decisión de
    // Fase 4, "solo completar infra") -- este Lambda no se despliega ni se
    // conecta a ningún flujo de login real en esta sesión.
    const preTokenGenerationFn = new lambda.Function(this, 'PreTokenGenerationFn', {
      functionName: `${prefix}-cognito-pre-token-generation`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: Duration.seconds(5),
      code: lambda.Code.fromInline(
        `exports.handler = async (event) => {
  const attrs = event.request.userAttributes || {};
  const role = attrs['custom:role'];
  const tenantId = attrs['custom:tenant_id'];
  const doctorId = attrs['custom:doctor_id'];

  // Cognito no acepta null en claimsToAddOrOverride -- se omite el claim
  // por completo en vez de forzar un valor vacío (el gateway ya trata
  // "claim ausente" igual que "claim null", ver verify-jwt.ts). Un
  // platform_admin/platform_support real nunca tiene custom:tenant_id
  // seteado (RFC-003: NULL identifica exclusivamente roles de plataforma),
  // así que tenant_id queda ausente para esos usuarios, igual que hoy hace
  // signAccessToken() localmente.
  const claimsToAddOrOverride = {};
  if (role) claimsToAddOrOverride.role = role;
  if (tenantId) claimsToAddOrOverride.tenant_id = tenantId;
  if (doctorId) claimsToAddOrOverride.doctor_id = doctorId;

  event.response = event.response || {};
  event.response.claimsOverrideDetails = { claimsToAddOrOverride };

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
        // RFC-004, filtro ABAC de propiedad ("un doctor solo ve sus propias
        // citas"): mismo campo que User.doctorId en services/auth/prisma/
        // schema.prisma -- referencia por id a Doctor en services/doctors,
        // sin FK real (RFC-001). Solo se setea para usuarios con role=doctor.
        doctor_id: new cognito.StringAttribute({ mutable: true }),
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
