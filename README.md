# Forklin Instagram Analytics

Painel de métricas do orgânico do **@forklinbr**: alcance e awareness da marca, desempenho de posts e stories, e benchmark com perfis de referência do segmento.

## O que o painel mostra

| Página | Conteúdo |
|---|---|
| **Visão geral** | Seguidores, contas alcançadas, visualizações, visitas ao perfil, cliques no site/links, contas com engajamento (com variação vs período anterior), alcance e visitas por dia, interações do período (curtidas, compartilhamentos, comentários, salvos, reposts, respostas), curva de seguidores e demografia (cidade, idade, gênero). |
| **Posts** | Por publicação: alcance, views, curtidas, comentários, compartilhamentos, salvos, reposts, visitas ao perfil, seguidores gerados e engajamento/alcance. Filtro por formato e alcance médio por formato. |
| **Stories** | Alcance, views, respostas, compartilhamentos, interações, navegação (avançou, voltou, saiu, pulou) e visitas ao perfil por story. |
| **Referências** | Comparativo com perfis do segmento (seguidores, frequência, interações, engajamento por seguidor, formatos) e insights automáticos: formato, dia, horário e traços de legenda que mais rendem. |
| **Curador** | Recebe imagem, carrossel ou vídeo, avalia a peça (gancho, texto na arte, identidade visual) e sugere 3 copies, CTA, hashtags e melhor horário, usando como base os posts de mais sucesso da Forklin e das referências. Vídeos: quadros e áudio são extraídos no navegador; a fala é transcrita com Whisper. |
| **Token e chaves** | Validade do token da Meta, troca do token, chave do Groq (Curador) e senha do app (protegidas por senha). |

## Arquitetura

```
web/            React + Vite + Recharts (painel)
supabase/
  migrations/   Tabelas fia_* (RLS ligado, sem acesso público) + agendamento pg_cron
  functions/
    fia-auth    Senha do app -> sessão assinada (HMAC). 12h para leitura, 15min para área admin
    fia-api     Leitura dos dados para o painel e cadastro de perfis de referência
    fia-token   Status do token da Meta, troca de token e troca de senha
    fia-sync    Coleta na Graph API do Instagram (v23) e grava no banco
    fia-curator Curador de posts via Groq (visão + Whisper) e histórico de análises
```

- **Banco:** Supabase (projeto `goxwnxfgusvxvqyijcyo`). Todas as tabelas têm prefixo `fia_`, RLS ligado e nenhuma permissão para `anon`/`authenticated`. Só as Edge Functions (service role) leem e escrevem.
- **Segredos:** o token da Meta, o hash da senha (PBKDF2-SHA256) e o segredo do cron ficam em `fia_app_config`, nunca no código.
- **Coleta:** `pg_cron` chama `fia-sync` todo dia, a cada hora (minuto 7). Stories só existem por 24h na API, por isso a coleta é horária. Perfis de referência são atualizados a cada ~20h. Demografia, uma vez por dia.
- **Referências:** via Business Discovery da Graph API (só dados públicos: seguidores, curtidas e comentários por post).

## Métricas e limitações da API

- `impressions` foi descontinuada pela Meta (v22+); usamos `views` e `reach`.
- Curtidas em stories não são expostas pela API; o painel usa respostas e interações totais.
- De perfis de terceiros só vêm curtidas e comentários (sem alcance, salvos ou compartilhamentos). A análise de referências usa o desempenho de cada post **relativo à mediana da própria conta**, para não favorecer perfis grandes.
- Demografia exige 100+ seguidores.

## Curador (Groq)

- Modelo de visão padrão: `qwen/qwen3.8-27b` (configurável na página Token e chaves). Até 3 imagens por análise: vídeos viram "quadro de abertura + grade de quadros"; carrosséis com mais de 3 slides viram grade.
- Transcrição: `whisper-large-v3-turbo`, com áudio convertido para WAV 16 kHz mono no navegador.
- A chave do Groq fica em `fia_app_config` (`groq_api_key`) e nunca é enviada ao navegador.

## Rodar localmente

```bash
cd web
npm install
npm run dev
```

## Publicar o painel

O frontend é estático (`web/dist`). Na Vercel: **Add New Project** → importar este repositório → **Root Directory: `web`** → Deploy.

## Publicar mudanças no Supabase

```bash
supabase link --project-ref goxwnxfgusvxvqyijcyo
supabase functions deploy fia-auth fia-api fia-token fia-sync --no-verify-jwt
```

## Renovar o token (a cada ~60 dias)

Página **Token de acesso** do painel → desbloquear com a senha → colar o token estendido → **Validar e salvar**. O passo a passo para gerar o token está na própria página.
