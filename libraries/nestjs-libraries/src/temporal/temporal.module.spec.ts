import { getTemporalModule } from '@gitroom/nestjs-libraries/temporal/temporal.module';

// the providers' list loads ESM-only packages that Jest can't require
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  socialIntegrationList: [],
}));

interface Worker {
  taskQueue: string;
  workflowsPath?: string;
  workerOptions?: { maxConcurrentActivityTaskExecutions?: number };
}

const workers = (): Worker[] => {
  const providers = getTemporalModule(true, '/workflows', []).providers as {
    provide?: string;
    useValue?: { workers?: Worker[] };
  }[];
  return (
    providers.find((provider) => provider.provide === 'TEMPORAL_MODULE_OPTIONS')?.useValue
      ?.workers || []
  );
};

describe('getTemporalModule', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('roda a renderização de composições numa fila própria com poucas execuções por servidor', () => {
    delete process.env.COMPOSITION_RENDER_CONCURRENCY;

    const render = workers().find((worker) => worker.taskQueue === 'composition-render');

    expect(render).toBeDefined();
    expect(render?.workflowsPath).toBeUndefined();
    expect(render?.workerOptions?.maxConcurrentActivityTaskExecutions).toBe(2);
  });

  it('usa a concorrência de renderização configurada', () => {
    process.env.COMPOSITION_RENDER_CONCURRENCY = '5';

    const render = workers().find((worker) => worker.taskQueue === 'composition-render');

    expect(render?.workerOptions?.maxConcurrentActivityTaskExecutions).toBe(5);
  });

  it('não roda a fila de renderização num servidor que a exclui', () => {
    process.env.EXCLUDE_QUEUE = 'composition-render';

    expect(workers().map((worker) => worker.taskQueue)).not.toContain('composition-render');
  });
});
