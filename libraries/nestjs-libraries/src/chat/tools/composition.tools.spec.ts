import { HttpException } from '@nestjs/common';
import { CompositionService } from '@gitroom/nestjs-libraries/database/prisma/compositions/composition.service';
import { CompositionCreateTool } from '@gitroom/nestjs-libraries/chat/tools/composition.create.tool';
import { CompositionsListTool } from '@gitroom/nestjs-libraries/chat/tools/compositions.list.tool';
import { CompositionGetTool } from '@gitroom/nestjs-libraries/chat/tools/composition.get.tool';
import { CompositionApproveTool } from '@gitroom/nestjs-libraries/chat/tools/composition.approve.tool';
import { CompositionDeleteTool } from '@gitroom/nestjs-libraries/chat/tools/composition.delete.tool';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';

// The service module loads ESM-only packages that Jest can't require, each
// test passes the stub of the calls it expects
jest.mock('@gitroom/nestjs-libraries/database/prisma/compositions/composition.service', () => ({
  CompositionService: class CompositionService {},
}));

const ORGANIZATION = { id: 'org', name: 'Pauta' };

interface ToolResult {
  output: Record<string, unknown> | Record<string, unknown>[];
}

const run = async (
  tool: AgentToolInterface,
  input: Record<string, unknown>
): Promise<ToolResult> => {
  const requestContext = new Map<string, string>([
    ['organization', JSON.stringify(ORGANIZATION)],
  ]);
  const created = tool.run() as unknown as {
    execute: (input: Record<string, unknown>, context: unknown) => Promise<ToolResult>;
  };
  return created.execute(input, { requestContext });
};

const serviceWith = (calls: Record<string, jest.Mock>): CompositionService =>
  calls as unknown as CompositionService;

const stored = {
  id: 'composicao',
  status: 'awaiting_approval',
  format: 'carousel',
  publishDate: new Date('2026-10-20T15:00:00.000Z'),
  requiresApproval: true,
  error: null,
  media: [{ id: 'midia', path: 'https://pauta.oriflow.io/uploads/slide.png' }],
  posts: [{ postId: 'post', integration: 'canal', target: 0 }],
  createdAt: new Date('2026-10-17T12:00:00.000Z'),
  updatedAt: new Date('2026-10-17T12:05:00.000Z'),
};

const validBody = {
  date: '2026-10-20T15:00:00.000Z',
  format: 'carousel',
  requiresApproval: true,
  slides: [
    { kicker: 'Reforma Tributária', headline: '5 pontos' },
    { headline: 'Quer ajuda?', theme: 'dark' },
  ],
  targets: [{ integrationId: 'canal', content: 'Legenda', settings: { post_type: 'post' } }],
};

describe('ferramentas de composição do MCP', () => {
  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://pauta.oriflow.io';
  });

  describe('compositionCreateTool', () => {
    it('inicia a composição com a organização da conexão e só os campos do contrato', async () => {
      const startComposition = jest
        .fn()
        .mockResolvedValue({ ...stored, status: 'pending', media: null, posts: null });
      const tool = new CompositionCreateTool(serviceWith({ startComposition }));

      const result = await run(tool, { ...validBody, campoExtra: 'descartado' });

      expect(result).toEqual({ output: { id: 'composicao', status: 'pending' } });
      expect(startComposition).toHaveBeenCalledTimes(1);
      const [org, body] = startComposition.mock.calls[0];
      expect(org).toEqual(ORGANIZATION);
      expect(body).toEqual(validBody);
      expect(body).not.toHaveProperty('campoExtra');
    });

    it('devolve as regras do contrato que o payload quebra sem iniciar nada', async () => {
      const startComposition = jest.fn();
      const tool = new CompositionCreateTool(serviceWith({ startComposition }));

      const result = await run(tool, {
        ...validBody,
        slides: [{ headline: 'Só um slide' }],
        targets: [{ integrationId: 'canal', content: ' ' }],
      });

      expect(startComposition).not.toHaveBeenCalled();
      const { errors } = result.output as { errors: string };
      expect(errors).toContain('carousel needs between 2 and 10 slides');
      expect(errors).toContain('content must not be empty');
    });

    it('devolve como erro a recusa do serviço', async () => {
      const startComposition = jest
        .fn()
        .mockRejectedValue(new HttpException('Channel canal is not available', 400));
      const tool = new CompositionCreateTool(serviceWith({ startComposition }));

      const result = await run(tool, validBody);

      expect(result).toEqual({ output: { errors: 'Channel canal is not available' } });
    });

    it('não esconde uma falha inesperada', async () => {
      const startComposition = jest.fn().mockRejectedValue(new Error('banco fora do ar'));
      const tool = new CompositionCreateTool(serviceWith({ startComposition }));

      await expect(run(tool, validBody)).rejects.toThrow('banco fora do ar');
    });
  });

  describe('compositionsListTool', () => {
    it('lista a página pedida filtrando pelo status, com datas em ISO e o link de prévia', async () => {
      const getCompositionsWithContent = jest.fn().mockResolvedValue([
        { ...stored, title: '5 pontos', size: 'portrait', slides: [], targets: [] },
      ]);
      const tool = new CompositionsListTool(serviceWith({ getCompositionsWithContent }));

      const result = await run(tool, { page: 2, status: 'awaiting_approval' });

      expect(getCompositionsWithContent).toHaveBeenCalledWith('org', 2, 'awaiting_approval');
      expect(result).toEqual({
        output: {
          compositions: [
            expect.objectContaining({
              id: 'composicao',
              title: '5 pontos',
              publishDate: '2026-10-20T15:00:00.000Z',
              createdAt: '2026-10-17T12:00:00.000Z',
              updatedAt: '2026-10-17T12:05:00.000Z',
              posts: [
                {
                  postId: 'post',
                  integration: 'canal',
                  target: 0,
                  previewUrl: 'https://pauta.oriflow.io/p/post?share=true',
                },
              ],
            }),
          ],
        },
      });
    });

    it('começa da primeira página quando nenhuma é informada', async () => {
      const getCompositionsWithContent = jest.fn().mockResolvedValue([]);
      const tool = new CompositionsListTool(serviceWith({ getCompositionsWithContent }));

      expect(await run(tool, {})).toEqual({ output: { compositions: [] } });
      expect(getCompositionsWithContent).toHaveBeenCalledWith('org', 0, undefined);
    });
  });

  describe('compositionGetTool', () => {
    it('mostra a composição com o conteúdo enviado', async () => {
      const getCompositionWithContent = jest.fn().mockResolvedValue({
        ...stored,
        title: '5 pontos',
        size: 'portrait',
        slides: [{ headline: '5 pontos' }],
        targets: [{ integrationId: 'canal', content: 'Legenda' }],
      });
      const tool = new CompositionGetTool(serviceWith({ getCompositionWithContent }));

      const result = await run(tool, { id: 'composicao' });

      expect(getCompositionWithContent).toHaveBeenCalledWith('org', 'composicao');
      expect(result.output).toEqual(
        expect.objectContaining({
          id: 'composicao',
          status: 'awaiting_approval',
          slides: [{ headline: '5 pontos' }],
          targets: [{ integrationId: 'canal', content: 'Legenda' }],
        })
      );
    });

    it('devolve como erro uma composição que não existe', async () => {
      const getCompositionWithContent = jest
        .fn()
        .mockRejectedValue(new HttpException('Composition not found', 404));
      const tool = new CompositionGetTool(serviceWith({ getCompositionWithContent }));

      expect(await run(tool, { id: 'outra' })).toEqual({
        output: { errors: 'Composition not found' },
      });
    });
  });

  describe('compositionApproveTool', () => {
    it('aprova e devolve a composição agendada', async () => {
      const approveComposition = jest.fn().mockResolvedValue({ ...stored, status: 'scheduled' });
      const tool = new CompositionApproveTool(serviceWith({ approveComposition }));

      const result = await run(tool, { id: 'composicao' });

      expect(approveComposition).toHaveBeenCalledWith('org', 'composicao');
      expect(result.output).toEqual(
        expect.objectContaining({ id: 'composicao', status: 'scheduled' })
      );
    });

    it('devolve como erro a aprovação acima do limite do plano', async () => {
      const approveComposition = jest
        .fn()
        .mockRejectedValue(
          new HttpException('You have reached the maximum number of posts for your subscription.', 402)
        );
      const tool = new CompositionApproveTool(serviceWith({ approveComposition }));

      expect(await run(tool, { id: 'composicao' })).toEqual({
        output: {
          errors: 'You have reached the maximum number of posts for your subscription.',
        },
      });
    });
  });

  describe('compositionDeleteTool', () => {
    it('exclui a composição da organização da conexão', async () => {
      const deleteComposition = jest.fn().mockResolvedValue({ id: 'composicao' });
      const tool = new CompositionDeleteTool(serviceWith({ deleteComposition }));

      expect(await run(tool, { id: 'composicao' })).toEqual({ output: { id: 'composicao' } });
      expect(deleteComposition).toHaveBeenCalledWith('org', 'composicao');
    });

    it('devolve como erro uma composição que não existe', async () => {
      const deleteComposition = jest
        .fn()
        .mockRejectedValue(new HttpException('Composition not found', 404));
      const tool = new CompositionDeleteTool(serviceWith({ deleteComposition }));

      expect(await run(tool, { id: 'outra' })).toEqual({
        output: { errors: 'Composition not found' },
      });
    });
  });

  it('deixa as ferramentas opcionais para quem conecta um Postiz próprio', () => {
    const tools = [
      CompositionCreateTool,
      CompositionsListTool,
      CompositionGetTool,
      CompositionApproveTool,
      CompositionDeleteTool,
    ];
    for (const Tool of tools) {
      const tool = new Tool(serviceWith({}));
      expect(tool.optionalOnSelfHosted).toBe(true);
      expect(tool.mcpOnly).toBeFalsy();
    }
  });
});
