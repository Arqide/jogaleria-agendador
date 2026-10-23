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

// ---------- TikTok (rascunho na caixa de entrada do app) ----------
// O token de acesso do TikTok dura 24 h; a cada uso renovamos com o refresh token (365 dias).
// Se o TikTok devolver um refresh token diferente, só avisa no log (o workflow não grava segredos).
let ttAccess = null;
async function tiktokToken() {
  if (ttAccess) return ttAccess;
  const { TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REFRESH_TOKEN } = process.env;
  if (!(TT_CLIENT_KEY && TT_CLIENT_SECRET && TT_REFRESH_TOKEN)) throw new Error('Faltam os segredos do TikTok (TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REFRESH_TOKEN)');
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: TT_CLIENT_KEY, client_secret: TT_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: TT_REFRESH_TOKEN }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`TikTok token: ${j.error_description || j.error || res.status}`);
  if (j.refresh_token && j.refresh_token !== TT_REFRESH_TOKEN) console.warn('::warning::O TikTok trocou a chave de renovação. Se os próximos envios falharem, reconectar com scripts/tiktok-conectar.sh');
  ttAccess = j.access_token;
  return ttAccess;
}

async function ttApi(path, body, tok) {
  const res = await fetch(`https://open.tiktokapis.com/v2/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.error && j.error.code !== 'ok') throw new Error(`TikTok ${path}: ${JSON.stringify(j.error)}`);
  return j.data;
}

// Envia o vídeo (arquivo do repositório) para os rascunhos; a pessoa abre a notificação no app e publica.
async function publicarTikTokRascunho(item) {
  const buf = readFileSync(item.files[0]);
  const size = buf.length;
  if (size > 64 * 1024 * 1024) throw new Error('Vídeo acima de 64 MB: precisa de envio em partes, ainda não suportado');
  const tok = await tiktokToken();
  const init = await ttApi('post/publish/inbox/video/init/', { source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } }, tok);
  const put = await fetch(init.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${size - 1}/${size}` },
    body: buf,
  });
  if (!put.ok) throw new Error(`TikTok upload HTTP ${put.status}: ${(await put.text()).slice(0, 200)}`);
  for (let t = 0; t < 180; t += 10) {
    const st = await ttApi('post/publish/status/fetch/', { publish_id: init.publish_id }, tok);
    if (st.status === 'SEND_TO_USER_INBOX' || st.status === 'PUBLISH_COMPLETE') return `tiktok:${init.publish_id}`;
    if (st.status === 'FAILED') throw new Error(`TikTok recusou o vídeo: ${st.fail_reason}`);
    await sleep(10000);
  }
  return `tiktok:${init.publish_id} (ainda processando)`;
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
  } else if (item.type === 'tiktok_rascunho') {
    return publicarTikTokRascunho(item);
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

// --probe tiktok-conta: mostra qual conta do TikTok está conectada (nome e usuário; nada sigiloso).
if (process.argv.includes('--probe') && process.argv[process.argv.indexOf('--probe') + 1] === 'tiktok-conta') {
  const tok = await tiktokToken();
  const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', { headers: { Authorization: `Bearer ${tok}` } });
  const j = await res.json();
  console.log(`[tiktok conta] nome: ${j.data?.user?.display_name} | usuário: @${j.data?.user?.username ?? '(sem permissão para usuário)'} | erro: ${j.error?.code}`);
  process.exit(0);
}

// --probe <id>: só prepara o container do item (sem publicar), para testar se o Instagram aceita o arquivo.
const probeIdx = process.argv.indexOf('--probe');
if (probeIdx !== -1) {
  const item = schedule.find((i) => i.id === process.argv[probeIdx + 1]);
  if (!item) { console.error('item não encontrado'); process.exit(1); }
  const f = url(item.files[0]);
  const params = item.type === 'reel' ? { media_type: 'REELS', video_url: f, caption: 'probe' }
    : item.type === 'story' ? { media_type: 'STORIES', image_url: f } : { image_url: f, caption: 'probe' };
  try {
    const id = await criarContainer(params, 600);
    console.log(`[probe ok] ${item.id}: container ${id} ficou FINISHED (não publicado)`);
  } catch (e) {
    console.error(`[probe erro] ${item.id}: ${e.message}`);
    process.exit(2);
  }
  process.exit(0);
}

const agora = Date.now();
let mudou = false;
const devidos = schedule
  .filter((i) => i.enabled !== false && !state[i.id]?.mediaId)
  .filter((i) => Date.parse(i.when) <= agora)
  .sort((a, b) => Date.parse(a.when) - Date.parse(b.when));

// Cada canal mantém a própria ordem: uma falha no TikTok não segura o Instagram, e vice-versa.
const canal = (i) => (i.type.startsWith('tiktok') ? 'tiktok' : 'instagram');
const travados = new Set();
for (const item of devidos) {
  if (travados.has(canal(item))) continue;
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
    // Os itens seguintes do mesmo canal esperam a próxima rodada, para manter a ordem da sequência.
    console.warn(`Segurando o resto do ${canal(item)} nesta rodada para não publicar fora de ordem.`);
    travados.add(canal(item));
    continue;
  }
  mudou = true;
  save();
}
if (mudou && !DRY) save();
if (!devidos.length) console.log('Nada a publicar agora.');
