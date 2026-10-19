// Publica no Instagram (API oficial) os itens do schedule.json que já chegaram na hora.
// Rodado a cada 15 min pelo GitHub Actions. Uso local: node publish.mjs [--dry]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const { IG_USER_ID, IG_TOKEN, PUBLIC_BASE } = process.env;
// Token do "login do Instagram" (instagram_business_*) usa graph.instagram.com; token de Página usa graph.facebook.com.
const GRAPH = `https://${process.env.GRAPH_HOST || 'graph.instagram.com'}/${process.env.GRAPH_VERSION || 'v21.0'}`;
const MAX_ATRASO_H = 24; // item atrasado mais que isso não sai sozinho (evita despejar posts velhos)
const MAX_TENTATIVAS = 3;

if (!DRY && !(IG_USER_ID && IG_TOKEN && PUBLIC_BASE)) {
  console.error('Faltam IG_USER_ID, IG_TOKEN ou PUBLIC_BASE nas variáveis de ambiente.');
  process.exit(1);
}

const schedule = JSON.parse(readFileSync('schedule.json', 'utf8'));
const state = existsSync('published.json') ? JSON.parse(readFileSync('published.json', 'utf8')) : {};
const save = () => writeFileSync('published.json', JSON.stringify(state, null, 2) + '\n');
const url = (p) => `${PUBLIC_BASE.replace(/\/$/, '')}/${p.split('/').map(encodeURIComponent).join('/')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, params, method = 'POST') {
  const body = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const res = await fetch(`${GRAPH}/${path}${method === 'GET' ? '?' + body : ''}`, {
    method,
    body: method === 'GET' ? undefined : body,
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(JSON.stringify(json.error || json));
  return json;
}

async function esperarPronto(id, maxSeg) {
  for (let t = 0; t < maxSeg; t += 5) {
    const { status_code, status } = await api(id, { fields: 'status_code,status' }, 'GET');
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`Container ${status_code}: ${status}`);
    await sleep(5000);
  }
  throw new Error('Container não ficou pronto a tempo');
}

// O Instagram às vezes responde "Media Not Found" (code 24) logo após criar o container; é passageiro, então tenta de novo.
async function criarContainer(params, maxSeg = 90, tentativa = 1) {
  try {
    const { id } = await api(`${IG_USER_ID}/media`, params);
    await esperarPronto(id, maxSeg);
    return id;
  } catch (e) {
    if (tentativa < 3 && /"code":24|Media Not Found|transient":true/.test(e.message)) {
      console.warn(`  container falhou (tentativa ${tentativa}), aguardando 20s para tentar de novo`);
      await sleep(20000);
      return criarContainer(params, maxSeg, tentativa + 1);
    }
    throw e;
  }
}

async function publicar(item) {
  const legenda = item.caption || '';
  let container;
  if (item.type === 'image') {
    container = await criarContainer({ image_url: url(item.files[0]), caption: legenda });
  } else if (item.type === 'carousel') {
    const filhos = [];
    for (const f of item.files) filhos.push(await criarContainer({ image_url: url(f), is_carousel_item: 'true' }));
    container = await criarContainer({ media_type: 'CAROUSEL', children: filhos.join(','), caption: legenda });
  } else if (item.type === 'story') {
    container = await criarContainer({ media_type: 'STORIES', image_url: url(item.files[0]) });
  } else if (item.type === 'reel') {
    container = await criarContainer(
      { media_type: 'REELS', video_url: url(item.files[0]), caption: legenda, share_to_feed: 'true' },
      600,
    );
  } else {
    throw new Error(`Tipo desconhecido: ${item.type}`);
  }
  return publicarContainer(container);
}

// A publicação também pode falhar com "Media Not Found" (code 24) por atraso do Instagram; tenta de novo antes de desistir.
async function publicarContainer(container, tentativa = 1) {
  try {
    const { id } = await api(`${IG_USER_ID}/media_publish`, { creation_id: container });
    return id;
  } catch (e) {
    if (tentativa < 3 && /"code":24|Media Not Found|transient":true/.test(e.message)) {
      console.warn(`  publicação falhou (tentativa ${tentativa}), aguardando 20s para tentar de novo`);
      await sleep(20000);
      return publicarContainer(container, tentativa + 1);
    }
    throw e;
  }
}

const agora = Date.now();
let mudou = false;
const devidos = schedule
  .filter((i) => i.enabled !== false && !state[i.id]?.mediaId)
  .filter((i) => Date.parse(i.when) <= agora)
  .sort((a, b) => Date.parse(a.when) - Date.parse(b.when));

for (const item of devidos) {
  const atrasoH = (agora - Date.parse(item.when)) / 3.6e6;
  const st = (state[item.id] ||= { tentativas: 0 });
  if (atrasoH > MAX_ATRASO_H) {
    st.erro = `Atrasado ${atrasoH.toFixed(1)}h: não publicado automaticamente`;
    console.warn(`[pulado] ${item.id}: ${st.erro}`);
    mudou = true;
    continue;
  }
  if (st.tentativas >= MAX_TENTATIVAS) continue;
  if (DRY) { console.log(`[dry] publicaria ${item.id} (${item.type}) previsto ${item.when}`); continue; }
  try {
    st.tentativas += 1;
    st.mediaId = await publicar(item);
    st.publicadoEm = new Date().toISOString();
    delete st.erro;
    console.log(`[ok] ${item.id} -> ${st.mediaId}`);
  } catch (e) {
    st.erro = String(e.message).slice(0, 500);
    console.error(`[erro] ${item.id} (tentativa ${st.tentativas}): ${st.erro}`);
    mudou = true;
    save();
    // Para aqui: os itens seguintes esperam a próxima rodada, para manter a ordem da sequência.
    console.warn('Parando esta rodada para não publicar fora de ordem.');
    break;
  }
  mudou = true;
  save();
}
if (mudou && !DRY) save();
if (!devidos.length) console.log('Nada a publicar agora.');
