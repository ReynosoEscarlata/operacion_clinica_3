import * as AWSXRay from 'aws-xray-sdk-core';

// Sin esto, prod paga una traza por cada request. Dev/staging: volumen bajo
// (no hay tráfico real todavía), trazar el 100% es barato y útil para
// depurar. Prod: fixed_target=1 (siempre traza al menos 1 req/seg) +
// rate=0.05 (5% del resto) -- controlado por XRAY_SAMPLING_RATE en
// config/env.ts de cada servicio, no hardcodeado por entorno acá.
export interface XraySamplingConfig {
  fixedTarget: number;
  rate: number;
}

export const FULL_SAMPLING: XraySamplingConfig = { fixedTarget: 1, rate: 1 };

export const configureSampling = (config: XraySamplingConfig): void => {
  AWSXRay.middleware.setSamplingRules({
    version: 2,
    default: { fixed_target: config.fixedTarget, rate: config.rate },
    rules: [],
  });
};
