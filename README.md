# WarmFlow — Aquecedor de números WhatsApp

Painel independente para aquecimento controlado de números próprios ou autorizados usando a UazAPI. O projeto é separado do FluxoZap principal: possui dependências, banco, filas, credenciais e deploy próprios.

> Use somente números sob sua responsabilidade e respeite os termos do WhatsApp, da UazAPI e as leis aplicáveis. O WarmFlow não promete evitar bloqueios nem contornar políticas da plataforma.

## O que o WarmFlow faz

- Dashboard de números conectados, progresso, métricas e eventos.
- Criação de instâncias UazAPI e conexão/reconexão por QR Code.
- Edição do nome exibido de cada número.
- Slots privados com dois ou mais números conectados.
- Edição do nome, perfil e cronograma dos slots enquanto não estão ativos.
- Perfis de aquecimento: **Leve**, **Moderado** e **Intenso controlado**.
- Cronogramas de **7 dias (recomendado)**, **14 dias** ou **30 dias**.
- Crescimento gradual do limite diário conforme o cronograma escolhido.
- Fila durável em MongoDB, idempotência diária, concorrência limitada e retries controlados.
- Pausa global, pausa por slot e horário de descanso.
- Webhook assíncrono para conexão, mensagens recebidas e métricas.

O aquecimento da v1 usa mensagens de texto entre membros do mesmo slot. A UazAPI também possui endpoints de mídia para imagem, áudio/voz, vídeo e documento; a fila de mídia ainda deve ser configurada com URLs/arquivos autorizados antes de ser habilitada no painel.

## Arquitetura

~~~text
React + Vite (dashboard)
          │
          ▼
Express + TypeScript (API e worker)
       │       │
       │       ├── UazAPI (instâncias e envios)
       │       └── MongoDB / banco AquecedorWhatsApp
       │
       └── fila durable: warmer_jobs
~~~

Coleções principais: warmer_config, warmer_numbers, warmer_slots, warmer_jobs, warmer_events e warmer_webhook_inbox.

Tokens de instância e admin token são criptografados com AES-256-GCM. Segredos ficam somente no .env ou na configuração persistida; nunca devem ser commitados.

## Requisitos

- Node.js 20+
- npm 10+
- MongoDB acessível pelo servidor
- Conta/servidor UazAPI
- URL HTTPS pública para webhooks em produção

## Desenvolvimento local

~~~bash
git clone https://github.com/Vitor-VX/aquecedor-whatsapp.git
cd aquecedor-whatsapp
npm ci
cp .env.example .env
npm run dev
~~~

Abra http://localhost:3100.

Comandos disponíveis:

~~~bash
npm run dev      # API + Vite em modo desenvolvimento
npm run lint     # TypeScript sem emissão
npm test         # testes dos planos de aquecimento
npm run build    # build do dashboard
npm start        # API em produção, servindo o build
~~~

## Variáveis de ambiente

Veja .env.example. As principais são:

| Variável | Uso |
| --- | --- |
| PORT | Porta da API, normalmente 3100 local ou 4321 no VPS |
| MONGODB_URI | URI do cluster MongoDB; o app usa o banco AquecedorWhatsApp |
| PUBLIC_BASE_URL | URL HTTPS pública usada no webhook |
| UAZAPI_SERVER_URL | URL do servidor UazAPI |
| UAZAPI_ADMIN_TOKEN | Admin token da UazAPI |
| INSTANCE_TOKEN_ENCRYPTION_KEY | Segredo com pelo menos 32 caracteres |

Nunca coloque tokens, senhas, URI privada ou .env no Git. O .gitignore já exclui esses arquivos.

## Fluxo operacional

1. Configure a URL e o admin token da UazAPI em Configurações.
2. Teste a integração.
3. Adicione um número, confirme que ele é próprio/autorizado e escaneie o QR Code.
4. Repita para pelo menos dois números conectados.
5. Crie um slot, escolha o perfil e selecione 7, 14 ou 30 dias.
6. Adicione os números ao slot e inicie o aquecimento.
7. Libere a fila global e acompanhe a evolução no dashboard.

Um slot ativo não pode ter o cronograma alterado. Pause o slot antes de editar seu nome, perfil ou duração.

## API interna principal

- GET /api/health — saúde da aplicação e conexão MongoDB.
- GET /api/dashboard — métricas, números, slots e eventos.
- POST /api/numbers — cria instância e inicia conexão.
- PATCH /api/numbers/:id — altera o nome exibido do número.
- GET /api/numbers/:id/status — consulta status na UazAPI.
- POST /api/numbers/:id/connect — gera nova conexão/QR Code.
- POST /api/slots — cria slot com perfil e duração.
- PATCH /api/slots/:id — edita slot pausado ou em rascunho.
- POST /api/slots/:id/assign — adiciona número ao slot.
- POST /api/slots/:id/start — inicia o cronograma.
- POST /api/slots/:id/pause — pausa o cronograma.
- POST /api/webhooks/uazapi — recebe eventos da UazAPI.

## Deploy com Git + PM2

O fluxo oficial de atualização é sempre Git:

~~~bash
# na máquina de desenvolvimento
git add .
git commit -m "descreve a alteração"
git push origin main

# no servidor
git pull --ff-only
npm ci
npm run lint
npm test
npm run build
pm2 restart aquecedor --update-env
pm2 save
~~~

Exemplo de primeira publicação no servidor:

~~~bash
cd /root/fluxozap
git clone https://github.com/Vitor-VX/aquecedor-whatsapp.git aquecedor
cd aquecedor
cp .env.example .env
npm ci
npm run build
pm2 start /root/.nvm/versions/node/v20.20.2/bin/npm \
  --name aquecedor --cwd /root/fluxozap/aquecedor -- start
pm2 save
~~~

Em produção, use Node 20 e mantenha INSTANCE_TOKEN_ENCRYPTION_KEY estável. Trocar essa chave sem migrar os tokens criptografados impede a aplicação de autenticar as instâncias existentes.

## Nginx

Exemplo de proxy para aqc.vilelarochaltda.sbs na porta 4321:

~~~nginx
server {
    listen 80;
    server_name aqc.vilelarochaltda.sbs;

    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
~~~

Depois, valide com nginx -t, recarregue o Nginx e emita o certificado TLS pelo Certbot.

## Segurança operacional

- Não envie mensagens para contatos externos, listas compradas ou números sem autorização.
- Não use grupos ou contatos de terceiros como estratégia de contorno de bloqueios.
- O webhook responde rapidamente e grava o evento em uma inbox durável para processamento posterior.
- Timeouts ficam marcados como uncertain para evitar duplicação cega.
- Erros 429 e 5xx usam retry limitado e respeitam Retry-After quando disponível.
- Tokens nunca são retornados ao navegador nem gravados em logs.

