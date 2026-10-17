import type { Config } from 'jest';
import { baseConfig } from './jest.config';

const config: Config = {
  ...baseConfig,
  testMatch: ['**/*.e2e-spec.ts'],
  testTimeout: 300000,
};

export default config;
