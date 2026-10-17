# API de composições

Recebe o conteúdo pronto de um post, gera as artes (slides de carrossel ou imagem única), salva na biblioteca de mídia e agenda a publicação nos canais conectados, com aprovação opcional.

Todas as rotas usam a chave de API da organização no header `Authorization` (a mesma chave da API pública do Postiz, exibida nas configurações da organização).

## Fluxo

1. `POST /public/v1/compositions` valida o payload e as configurações de cada canal e responde `201` com `{ id, status: "pending" }`.
2. O workflow `compositionWorkflow` (Temporal) renderiza os slides, salva as imagens e cria os posts.
3. O status evolui `pending → rendering → scheduling → awaiting_approval | scheduled`, ou `failed` com a mensagem em `error`.
4. Com `requiresApproval: true` os posts ficam como rascunho até `POST /:id/approve`. Edições feitas no painel do Postiz enquanto o post é rascunho são preservadas na aprovação.
5. Na data informada o Postiz publica pelos providers de cada rede.

## Criar

`POST /public/v1/compositions`

```json
{
  "date": "2026-10-20T15:00:00.000Z",
  "format": "carousel",
  "requiresApproval": true,
  "size": "portrait",
  "brand": {
    "primaryColor": "#6D4AFF",
    "darkColor": "#17151F",
    "lightColor": "#FFFFFF",
    "headingFont": "Bricolage Grotesque",
    "bodyFont": "Manrope",
    "name": "connectabil",
    "handle": "@connectabil",
    "logoUrl": "https://cdn.exemplo.com/logo.png"
  },
  "slides": [
    { "kicker": "Reforma Tributária", "headline": "5 pontos que sua empresa precisa acompanhar", "body": "Arraste para o lado →" },
    { "kicker": "Ponto 01", "headline": "O cronograma de transição", "body": "Entre 2026 e 2033.", "background": { "type": "ai", "prompt": "escritório contábil moderno, luz natural" } },
    { "kicker": "Próximo passo", "headline": "Quer ajuda na transição?", "theme": "dark" }
  ],
  "targets": [
    { "integrationId": "<id do Instagram>", "content": "Legenda do Instagram", "settings": { "post_type": "post" } },
    { "integrationId": "<id da página do LinkedIn>", "content": "Legenda do LinkedIn", "settings": { "post_as_images_carousel": true, "carousel_name": "Reforma Tributária" } },
    { "integrationId": "<id do X>", "content": "Fio 1/2", "comments": ["Fio 2/2"], "settings": { "who_can_reply_post": "everyone" } }
  ],
  "tags": [{ "value": "reforma", "label": "Reforma" }]
}
```

| Campo | Regra |
| --- | --- |
| `date` | ISO 8601. Data da publicação em todos os canais. |
| `format` | `carousel` (2 a 10 slides), `image` (1 slide) ou `text` (sem slides). |
| `size` | `portrait` 1080×1350 (padrão), `square` 1080×1080, `story` 1080×1920. |
| `brand` | Opcional. Cores `#RRGGBB`, fontes do Google Fonts, `logoUrl` HTTPS. Sem marca usa o modelo Editorial roxo. |
| `slides[].theme` | `accent`, `light` ou `dark`. Padrão: capa `accent`, último slide (de 3 ou mais) `dark`, demais `light`. |
| `slides[].background` | `{ "type": "ai", "prompt" }` gera a imagem com IA (consome créditos `ai_images`, exige `OPENAI_API_KEY`); `{ "type": "url", "url" }` usa uma imagem HTTPS pública. A imagem é gerada vertical, ou quadrada em `size: "square"`. O texto é sobreposto com degradê para legibilidade. |
| `targets[]` | 1 a 20 canais. `content` é a legenda (quebras de linha preservadas), `comments` vira o fio/comentários seguintes (só em canais que publicam comentários), `settings` são as configurações do provider (as mesmas de `GET /public/v1/integration-settings/:id`, até 20 000 caracteres em JSON e 10 níveis). |

Respostas de erro imediatas: `402` quando faltam créditos de IA para os fundos `type: "ai"` (só com cobrança ativa), `429` acima do limite de requisições da API pública, e `400` para payload inválido, canal inexistente, desativado ou de outra organização, `comments` em canal que não publica comentários, e configurações obrigatórias do provider ausentes (a mensagem cita o campo, por exemplo `who_can_reply_post`).

Erros que só aparecem durante a geração (imagem remota inacessível, mídia incompatível com a rede, limite de caracteres) deixam a composição em `failed` com o motivo em `error`.

## Consultar

`GET /public/v1/compositions/:id` e `GET /public/v1/compositions?page=0` (20 por página).

```json
{
  "id": "…",
  "status": "awaiting_approval",
  "format": "carousel",
  "publishDate": "2026-10-20T15:00:00.000Z",
  "requiresApproval": true,
  "error": null,
  "media": [{ "id": "…", "path": "https://…/uploads/2026/10/17/….png" }],
  "posts": [{ "postId": "…", "integration": "<id do canal>", "target": 0 }],
  "createdAt": "…",
  "updatedAt": "…"
}
```

## Aprovar

`POST /public/v1/compositions/:id/approve`. Só para composições em `awaiting_approval`; passa os posts para a fila de publicação e retorna a composição com `status: "scheduled"`. Uma aprovação por vez: outra enviada enquanto a primeira enfileira os posts responde `400`, e uma que parou no meio pode ser reenviada depois de dois minutos.

## Excluir

`DELETE /public/v1/compositions/:id`. Interrompe a geração se ainda estiver em andamento, remove os posts (cancelando a publicação agendada) e a composição. Pode ser reenviado: uma exclusão interrompida termina de remover os posts.

## Configuração

| Variável | Uso |
| --- | --- |
| `CHROMIUM_EXECUTABLE_PATH` | Chromium usado pelo orchestrator. Vazio usa o instalado por `pnpm exec playwright-core install chromium` (já incluso na imagem Docker). |
| `OPENAI_API_KEY` | Necessária apenas para fundos `type: "ai"`. |
| `COMPOSITION_RENDER_CONCURRENCY` | Quantas composições cada orchestrator renderiza ao mesmo tempo (padrão 2), para o Chromium não disputar memória com a publicação. |
| `STORAGE_PROVIDER` | `local` ou `cloudflare`, como o restante das mídias do Postiz. |

Segurança: o HTML dos slides é renderizado com JavaScript desativado e só pode acessar o Google Fonts. Imagens remotas são baixadas pelo orchestrator com proteção contra SSRF (endereços internos são bloqueados, inclusive escritos como IP), limitadas a 15 MB durante o download, com timeout de 30 s, e reencodadas em PNG.

Retentativas: cada slide e cada post é gravado na composição assim que existe, então uma nova tentativa continua de onde parou sem cobrar a IA de novo nem duplicar posts. Falhas de rede (inclusive DNS temporariamente indisponível), 5xx e 429 são retentadas; erros que não mudam com nova tentativa encerram a composição em `failed`.

## Testes

- Unitários e de integração (Chromium real): `CHROMIUM_EXECUTABLE_PATH=/caminho/do/chromium pnpm test`
- E2E contra a stack completa (Postgres, Redis, Temporal, backend e orchestrator rodando): `pnpm exec dotenv -e .env -- pnpm test:e2e`
