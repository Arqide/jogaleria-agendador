# Agendador Jogaleria (Instagram, grátis)

Publica posts, carrosséis, stories e reels da conta jogaleria.oficial pela API oficial do Instagram.
O GitHub Actions roda `publish.mjs` a cada 15 min e publica o que estiver no horário.

## Como funciona
- `schedule.json`: lista do mês (data/hora com fuso `-03:00`, tipo, arquivos, legenda).
  - tipos: `image`, `carousel` (vários `files`), `story` (1 arquivo por quadro), `reel` (arquivo `.mp4`).
- `assets/`: artes em **JPEG** (a API só aceita JPEG). Use `scripts/preparar-imagens.sh <pasta>`.
- `published.json`: registro do que já saiu (o script atualiza sozinho).
- `node publish.mjs --dry` mostra o que sairia agora, sem publicar.

## Configuração (uma vez só)
1. App no Meta for Developers (grátis) com o produto Instagram; gerar token de longa duração para a conta
   jogaleria.oficial com as permissões `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   `pages_read_engagement`.
2. Repositório no GitHub com esta pasta.
3. Em Settings > Secrets and variables > Actions, criar: `IG_USER_ID` e `IG_TOKEN`.
   (Você mesma cola o token ali; ele nunca fica em arquivo.)
4. Testar com um story antes de ligar o mês inteiro.

## Regras da marca aplicadas
- Sem posts e sem stories aos sábados.
- Stories sem adesivos de interação (a API não os cria).
- Ache o Peão: nunca escrever "brinde".
