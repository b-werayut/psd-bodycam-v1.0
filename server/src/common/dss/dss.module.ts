import { Global, Module } from '@nestjs/common';
import { DSS_CLIENT, type DssClient } from './dss-client';
import { readDssConfig, type DssConfig } from './dss-config';
import { DssHttpClient } from './dss-http.client';
import { DssMockClient } from './dss-mock.client';

export function createDssClient(config: DssConfig): DssClient {
  return config.driver === 'dss' ? new DssHttpClient(config) : new DssMockClient(config.mockDevices);
}

/** One DSS client per process, chosen by `DSS_DRIVER` at boot. */
@Global()
@Module({
  providers: [{ provide: DSS_CLIENT, useFactory: () => createDssClient(readDssConfig(process.env)) }],
  exports: [DSS_CLIENT],
})
export class DssModule {}
