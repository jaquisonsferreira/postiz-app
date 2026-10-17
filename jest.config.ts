import type { Config } from 'jest';

export const baseConfig: Config = {
  rootDir: __dirname,
  testEnvironment: 'node',
  roots: ['<rootDir>/libraries', '<rootDir>/apps/backend', '<rootDir>/apps/orchestrator'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$': '<rootDir>/libraries/nestjs-libraries/src/$1',
  },
};

const config: Config = {
  ...baseConfig,
  testMatch: ['**/*.spec.ts'],
};

export default config;
