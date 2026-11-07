# WarmFlow — Aquecedor de números

Aplicação independente do FluxoZap para orquestrar, em ambiente privado, um plano gradual de comunicação entre números próprios ou autorizados conectados pela UazAPI.

## Separação de responsabilidades

- Repositório, dependências e deploy próprios.
- Banco MongoDB dedicado: `AquecedorWhatsApp`.
- Coleções prefixadas com `warmer_`.
- Tokens de instância e admin token criptografados com AES-256-GCM.
- Nenhuma dependência de código ou runtime do projeto `fluxozap`.

## Recursos da v1

- Dashboard de números conectados, em aquecimento, prontos e com atenção.
- Criação de instâncias UazAPI e conexão/reconexão por QR Code.
- Slots com dois ou mais números próprios.
- Perfis Leve, Moderado e Intenso controlado, com evolução por sete dias.
- Fila durável no MongoDB, idempotência diária, concorrência limitada e retries com jitter.
- Pausa global e pausa por slot.
- Horário de descanso configurável.
- Webhook assíncrono para conexão, mensagens recebidas e atualização de métricas.
- Tokens nunca retornados ao navegador ou registrados em logs.

## O que esta versão não faz

- Não envia mensagens para contatos externos ou listas compradas.
- Não promete evitar bloqueios ou contornar as políticas do WhatsApp.
- Não cria grupos automaticamente. Primeiro validamos pares, filas e mensagens bidirecionais; grupos podem ser avaliados depois.
- Não inicia um slot com menos de dois números conectados.

## Executar

```bash
cp .env.example .env
npm install
npm run dev
```

Abra `http://localhost:3100`.

Variáveis obrigatórias:

- `MONGODB_URI`: pode apontar para o mesmo cluster, mas o app usa o banco `AquecedorWhatsApp`.
- `INSTANCE_TOKEN_ENCRYPTION_KEY`: segredo de pelo menos 32 caracteres.
- `UAZAPI_SERVER_URL` e `UAZAPI_ADMIN_TOKEN`: podem ser definidos no `.env` ou pela tela de configurações.
- `PUBLIC_BASE_URL`: URL HTTPS pública usada em `/api/webhooks/uazapi`.

## Fluxo operacional

1. Configure e teste a UazAPI.
2. Crie as instâncias e escaneie os QR Codes.
3. Crie um slot e adicione pelo menos dois números conectados.
4. Escolha o perfil e inicie o aquecimento.
5. Libere a fila global.
6. Acompanhe mensagens enviadas, recebidas, falhas e progresso de sete dias.

## Segurança operacional

O webhook responde `200` imediatamente e grava o evento em uma inbox durável para processamento posterior. Envios com timeout são marcados como `uncertain` e não são repetidos cegamente. Erros `429` e `5xx` usam retry limitado e respeitam `Retry-After` quando disponível.
