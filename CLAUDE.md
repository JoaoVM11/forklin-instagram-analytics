# CLAUDE.md

Painel de analytics do Instagram da Forklin (@forklinbr). Leia o README para a visão geral.

## Convenções
- Interface e textos em português (pt-BR). Números com `Intl` pt-BR (helpers em `web/src/lib/format.ts`).
- Identidade visual: tokens institucionais da Forklin em `web/src/index.css` (`--forklin-*`, fonte Montserrat). O índigo `#475DFB` é só do símbolo; não usar na interface.
- Gráficos: série única em `--series-1` (#1F66C2); segunda série em `--series-2` (#0EA5D9). Paleta validada para daltonismo; não adicionar cores sem validar.
- Tabelas do banco sempre com prefixo `fia_` (o projeto Supabase é compartilhado com outra ferramenta).
- Nunca expor tabelas a `anon`/`authenticated`; todo acesso passa pelas Edge Functions com sessão (`x-session`).
- Nunca commitar token da Meta, senha ou segredos. Eles vivem em `fia_app_config`.

## Comandos
- `cd web && npm run dev` / `npm run build` / `npx tsc -b`
- Deploy das funções: `supabase functions deploy <nome> --no-verify-jwt`
