#!/bin/zsh
# Converte as artes para JPEG (a API do Instagram só aceita JPEG) e confere o tamanho.
# Uso: ./scripts/preparar-imagens.sh <pasta-de-origem>   -> grava em assets/
set -e
ORIGEM="${1:?Passe a pasta com as artes (PNG/JPG)}"
DESTINO="$(cd "$(dirname "$0")/.." && pwd)/assets"
mkdir -p "$DESTINO"
find "$ORIGEM" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) | while read -r f; do
  nome="$(basename "${f%.*}").jpg"
  sips -s format jpeg -s formatOptions 92 "$f" --out "$DESTINO/$nome" >/dev/null
  w=$(sips -g pixelWidth "$DESTINO/$nome" | awk '/pixelWidth/{print $2}')
  h=$(sips -g pixelHeight "$DESTINO/$nome" | awk '/pixelHeight/{print $2}')
  kb=$(( $(stat -f%z "$DESTINO/$nome") / 1024 ))
  echo "$nome  ${w}x${h}  ${kb}KB"
done
