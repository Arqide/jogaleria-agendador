#!/bin/zsh
# Conecta o TikTok da Jogaleria ao agendador. Quem roda é a Vanessa, no Terminal do Mac.
# As chaves vão direto para os segredos do GitHub; nada aparece na tela.
set -e
REPO="Arqide/jogaleria-agendador"
REDIRECT="https://github.com/Arqide/jogaleria-agendador"

echo "1/4  Cole o Client key do app do TikTok e aperte Enter:"
read -r CK
echo "2/4  Cole o Client secret (não aparece enquanto cola) e aperte Enter:"
read -rs CS; echo

STATE=$(openssl rand -hex 8)
URL="https://www.tiktok.com/v2/auth/authorize/?client_key=${CK}&scope=user.info.basic,video.upload&response_type=code&redirect_uri=$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$REDIRECT")&state=${STATE}"
open "$URL"
echo "3/4  No navegador: entre na conta da Jogaleria e autorize."
echo "     Depois, copie o endereço inteiro da página do GitHub que abrir (⌘L, ⌘C) e aperte Enter aqui."
read -r _

CODE=$(pbpaste | python3 -c 'import sys,urllib.parse as u;q=u.parse_qs(u.urlparse(sys.stdin.read().strip()).query);print(q.get("code",[""])[0])')
[ -z "$CODE" ] && { echo "Não achei o código no endereço copiado. Rode de novo."; exit 1; }

RESP=$(curl -s -X POST https://open.tiktokapis.com/v2/oauth/token/ \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "client_key=$CK" --data-urlencode "client_secret=$CS" \
  --data-urlencode "code=$CODE" --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "redirect_uri=$REDIRECT")
RT=$(printf %s "$RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("refresh_token",""))')
if [ -z "$RT" ]; then
  echo "O TikTok não aceitou: $(printf %s "$RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("error",""),d.get("error_description",""))')"
  exit 1
fi

echo "4/4  Guardando no GitHub..."
printf %s "$CK" | gh secret set TT_CLIENT_KEY -R "$REPO"
printf %s "$CS" | gh secret set TT_CLIENT_SECRET -R "$REPO"
printf %s "$RT" | gh secret set TT_REFRESH_TOKEN -R "$REPO"
unset CK CS RT RESP CODE
echo "FEITO: TikTok conectado"
