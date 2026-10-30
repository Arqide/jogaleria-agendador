// Gera painel.html (artefato "Agenda Jogaleria") a partir de schedule.json + published.json + notion-proximas.json.
// Uso: node scripts/painel.mjs   (miniaturas ficam em cache em originais/thumbs/)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const s = JSON.parse(readFileSync('schedule.json', 'utf8'));
const pub = existsSync('published.json') ? JSON.parse(readFileSync('published.json', 'utf8')) : {};
const prox = existsSync('notion-proximas.json') ? JSON.parse(readFileSync('notion-proximas.json', 'utf8')) : [];
const tz = 'America/Sao_Paulo';
const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

mkdirSync('originais/thumbs', { recursive: true });
const thumbs = {};
function thumb(f) {
  if (thumbs[f] !== undefined) return thumbs[f];
  const out = `originais/thumbs/${basename(f).replace(/\.\w+$/, '')}.jpg`;
  try {
    if (!existsSync(out)) {
      if (/\.mp4$/i.test(f)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.5', '-i', f, '-frames:v', '1', '-vf', 'scale=150:-2', '-q:v', '6', out]);
      else execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '55', '-Z', '190', f, '--out', out], { stdio: 'ignore' });
    }
    thumbs[f] = 'data:image/jpeg;base64,' + readFileSync(out).toString('base64');
  } catch { thumbs[f] = ''; }
  return thumbs[f];
}

const partes = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, year: 'numeric', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  .formatToParts(d).reduce((a, x) => ((a[x.type] = x.value), a), {});
const diaChave = (iso) => { const p = partes(new Date(iso)); return `${p.year}-${p.month}-${p.day}`; };
const hora = (iso) => { const p = partes(new Date(iso)); return `${p.hour}:${p.minute}`; };

function situacao(i) {
  if (i.studio) return Date.parse(i.when) <= Date.now() ? { k: 'ok', t: 'Publicado no TikTok' } : { k: 'agendado', t: 'Programado no TikTok' };
  const st = pub[i.id];
  if (st?.mediaId) return { k: 'ok', t: i.type === 'tiktok_rascunho' ? 'Enviado ao app' : 'Publicado', quando: st.publicadoEm };
  if (st?.erro?.startsWith('Atrasado')) return { k: 'pulou', t: 'Não saiu (passou da hora)' };
  if (st?.erro) return { k: 'erro', t: 'Erro, tentando de novo' };
  if (i.enabled === false) return { k: 'pausa', t: 'Desligado' };
  return { k: 'agendado', t: 'Agendado' };
}
const nomeTipo = { image: 'Post', carousel: 'Carrossel', story: 'Stories', reel: 'Reels', tiktok_rascunho: 'TikTok (rascunho)', tiktok_studio: 'TikTok' };
const titulo = (i) => i.id.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^(post|carrossel|reel|tiktok|stories)-/, '').replace(/-\d+$/, '').replace(/-/g, ' ');

// Agrupa stories seguidos do mesmo dia num cartão só.
const itens = [];
for (const i of s) {
  const ult = itens[itens.length - 1];
  if (i.type === 'story' && ult?.tipo === 'story' && ult.dia === diaChave(i.when) && titulo(i) === ult.titulo) {
    ult.thumbs.push(thumb(i.files[0])); ult.n += 1; ult.sits.push(situacao(i).k); continue;
  }
  const sit = situacao(i);
  itens.push({
    id: i.id, dia: diaChave(i.when), hora: hora(i.when), when: i.when, tipo: i.type, rotulo: nomeTipo[i.type] || i.type,
    canal: i.type.startsWith('tiktok') ? 'tiktok' : 'instagram', titulo: titulo(i), n: i.files.length,
    thumbs: (i.cover ? [i.cover] : i.files).slice(0, 4).map(thumb), legenda: i.caption || '',
    sits: [sit.k], sit, nota: /reenvio|v2$/.test(i.id) ? 'reenvio' : '',
  });
}
for (const it of itens) {
  if (it.tipo !== 'story') continue;
  const ks = it.sits;
  it.sit = ks.every((k) => k === 'ok') ? { k: 'ok', t: `${it.n} publicados` } : ks.some((k) => k === 'erro') ? { k: 'erro', t: 'Erro em algum quadro' }
    : ks.every((k) => k === 'agendado') ? { k: 'agendado', t: 'Agendado' } : ks.every((k) => k === 'pulou') ? { k: 'pulou', t: 'Não saiu (passou da hora)' } : { k: 'erro', t: 'Saiu em parte' };
}

const hoje = diaChave(new Date().toISOString());
const pendNotion = prox.filter((n) => n.d >= hoje).map((n) => ({ d: n.d, nome: n.nome, tipo: n.tipo, canal: n.canal, arq: n.arquivos || 0 }));
const agora = new Date();
const atualizado = `${partes(agora).day}/${partes(agora).month} às ${partes(agora).hour}:${partes(agora).minute}`;
const dados = { itens, hoje, pendNotion, dias, meses, atualizado };

const html = `<title>Agenda Jogaleria</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap">
<style>
/* Layout: coluna única tipo agenda de mesa; cada dia é uma "fileira" com a data num marcador à esquerda. Cores da marca Jogaleria. */
:root{
  --bg:#F6EFE2; --card:#FFFBF3; --fg:#2B1D16; --mut:#7A6656; --line:#E4D6BF;
  --vinho:#992C50; --roxo:#5D4BAA; --verde:#438262; --marrom:#5C3B2A;
  --ok:#2F7A55; --ok-bg:#DDEEE3; --warn:#9A5B00; --warn-bg:#F7E7C6; --bad:#A2283C; --bad-bg:#F6DADF; --ag-bg:#E6E1F5;
  --tt:#1A1A1A; --tt-fg:#fff;
  --f-disp:"Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif;
  --f-body:"Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#1C1512; --card:#271E1A; --fg:#F2E8D8; --mut:#B8A592; --line:#3C2F28;
  --vinho:#E07A9C; --roxo:#A99AF0; --verde:#7CC59D; --marrom:#D5AE8F;
  --ok:#8FD9AE; --ok-bg:#1F3A2C; --warn:#F2C26B; --warn-bg:#3E2F14; --bad:#F29AA9; --bad-bg:#46202A; --ag-bg:#2E2850;
  --tt:#F2E8D8; --tt-fg:#1C1512; color-scheme:dark}}
:root[data-theme="dark"]{
  --bg:#1C1512; --card:#271E1A; --fg:#F2E8D8; --mut:#B8A592; --line:#3C2F28;
  --vinho:#E07A9C; --roxo:#A99AF0; --verde:#7CC59D; --marrom:#D5AE8F;
  --ok:#8FD9AE; --ok-bg:#1F3A2C; --warn:#F2C26B; --warn-bg:#3E2F14; --bad:#F29AA9; --bad-bg:#46202A; --ag-bg:#2E2850;
  --tt:#F2E8D8; --tt-fg:#1C1512; color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.5 var(--f-body)}
.wrap{max-width:860px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:22px}
header{display:flex;flex-direction:column;gap:6px}
h1{font:800 clamp(30px,6vw,44px)/1.05 var(--f-disp);margin:0;color:var(--vinho);letter-spacing:-.01em;text-wrap:balance}
.sub{color:var(--mut);margin:0}
.resumo{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.res{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.res b{font:700 26px/1 var(--f-disp);font-variant-numeric:tabular-nums}
.res span{color:var(--mut);font-size:13px}
.res.tt b{color:var(--roxo)} .res.ok b{color:var(--ok)} .res.bad b{color:var(--bad)}
@media (max-width:560px){.resumo{grid-template-columns:repeat(2,minmax(0,1fr))}}
.abas{display:flex;gap:6px;flex-wrap:wrap;position:sticky;top:env(safe-area-inset-top,0px);background:var(--bg);padding-block:8px;z-index:2}
.aba,.filtro{font:600 14px var(--f-body);border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:999px;padding:7px 14px;cursor:pointer}
.aba[aria-selected="true"]{background:var(--vinho);border-color:var(--vinho);color:var(--card)}
.filtros{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.filtro{font-weight:500;padding:5px 11px;font-size:13px}
.filtro[aria-pressed="true"]{border-color:var(--roxo);color:var(--roxo);box-shadow:inset 0 0 0 1px var(--roxo)}
button:focus-visible{outline:2px solid var(--roxo);outline-offset:2px}
.dia{display:grid;grid-template-columns:76px minmax(0,1fr);gap:14px;padding-block:14px;border-top:1px solid var(--line)}
.data{display:flex;flex-direction:column;align-items:flex-start;gap:0}
.data .n{font:800 34px/1 var(--f-disp);font-variant-numeric:tabular-nums}
.data .m{font:600 12px var(--f-body);text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
.data .s{font:600 13px var(--f-body);color:var(--marrom)}
.data.hoje .n{color:var(--vinho)}
.data .tag{margin-top:4px;font:700 11px var(--f-body);letter-spacing:.06em;text-transform:uppercase;background:var(--vinho);color:var(--card);border-radius:4px;padding:1px 6px}
.lista{display:flex;flex-direction:column;gap:8px;min-width:0}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:grid;grid-template-columns:52px minmax(0,1fr) auto;gap:12px;align-items:center}
.hora{font:700 16px var(--f-disp);font-variant-numeric:tabular-nums}
.meio{display:flex;flex-direction:column;gap:4px;min-width:0}
.linha{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.canal{font:700 11px var(--f-body);letter-spacing:.05em;text-transform:uppercase;border-radius:4px;padding:2px 6px}
.canal.instagram{background:var(--vinho);color:var(--card)}
.canal.tiktok{background:var(--tt);color:var(--tt-fg)}
.tipo{font-weight:600;font-size:14px}
.tit{color:var(--mut);font-size:14px;text-transform:capitalize;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.pill{font:600 12px var(--f-body);border-radius:999px;padding:3px 10px;white-space:nowrap}
.pill.ok{background:var(--ok-bg);color:var(--ok)} .pill.agendado{background:var(--ag-bg);color:var(--roxo)}
.pill.erro{background:var(--warn-bg);color:var(--warn)} .pill.pulou,.pill.pausa{background:var(--bad-bg);color:var(--bad)}
.thumbs{display:flex;gap:4px}
.thumbs img{width:34px;height:42px;object-fit:cover;border-radius:4px;border:1px solid var(--line);background:var(--line)}
details{grid-column:2 / -1}
summary{cursor:pointer;color:var(--roxo);font-size:13px;font-weight:600}
.leg{white-space:pre-wrap;font-size:14px;background:var(--bg);border-radius:8px;padding:10px 12px;margin:8px 0 0;max-width:65ch;overflow-wrap:anywhere}
.copiar{margin-top:6px;font:600 13px var(--f-body);border:1px solid var(--roxo);color:var(--roxo);background:transparent;border-radius:8px;padding:5px 10px;cursor:pointer}
.aviso{font-size:13px;color:var(--mut)}
.vazio{color:var(--mut);padding:18px 0}
.notion{width:100%;border-collapse:collapse;font-size:14px}
.notion th{text-align:left;font:600 12px var(--f-body);text-transform:uppercase;letter-spacing:.06em;color:var(--mut);padding:8px 10px;border-bottom:1px solid var(--line)}
.notion td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.notion td:first-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.tbl{overflow-x:auto}
@media (max-width:520px){.dia{grid-template-columns:1fr;gap:8px}.data{flex-direction:row;align-items:baseline;gap:8px}.item{grid-template-columns:44px minmax(0,1fr)}.item .pill{grid-column:2;justify-self:start}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style>
<div class="wrap">
  <header>
    <h1>Agenda Jogaleria</h1>
    <p class="sub">Instagram @jogaleria.oficial e TikTok · atualizado em <span id="atual"></span></p>
  </header>
  <section class="resumo" id="resumo"></section>
  <nav class="abas" role="tablist">
    <button class="aba" role="tab" id="aba-prox" data-aba="prox" aria-selected="true">Programado</button>
    <button class="aba" role="tab" id="aba-saiu" data-aba="saiu" aria-selected="false">Já saiu</button>
    <button class="aba" role="tab" id="aba-notion" data-aba="notion" aria-selected="false">Falta no Notion</button>
    <div class="filtros" id="filtros">
      <button class="filtro" id="f-todos" data-f="todos" aria-pressed="true">Todos</button>
      <button class="filtro" id="f-ig" data-f="instagram" aria-pressed="false">Instagram</button>
      <button class="filtro" id="f-tt" data-f="tiktok" aria-pressed="false">TikTok</button>
    </div>
  </nav>
  <main id="conteudo"></main>
</div>
<script>
const D = ${JSON.stringify(dados)};
let aba = 'prox', filtro = 'todos';
try { aba = localStorage.getItem('aba') || aba; } catch {}
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('#atual').textContent = D.atualizado;

const futuros = D.itens.filter((i) => i.sit.k === 'agendado' || i.sit.k === 'erro');
const saidos = D.itens.filter((i) => !(i.sit.k === 'agendado' || i.sit.k === 'erro'));
const semana = futuros.filter((i) => i.dia <= somaDias(D.hoje, 7));
const ttSemana = semana.filter((i) => i.canal === 'tiktok').length;
const problemas = D.itens.filter((i) => i.sit.k === 'erro' || (i.sit.k === 'pulou' && i.dia >= somaDias(D.hoje, -7))).length;
function somaDias(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
$('#resumo').innerHTML = [
  ['', semana.length, 'programados nos próximos 7 dias'],
  ['tt', ttSemana, 'TikToks que você publica no app'],
  ['ok', saidos.filter((i) => i.sit.k === 'ok').length, 'já saíram'],
  ['bad', problemas, problemas === 1 ? 'precisa de atenção' : 'precisam de atenção'],
].map(([c, n, t]) => '<div class="res ' + c + '"><b>' + n + '</b><span>' + t + '</span></div>').join('');

function cartao(i) {
  const leg = i.legenda ? '<details><summary>' + (i.canal === 'tiktok' ? 'Legenda para colar no TikTok' : 'Ver legenda') + '</summary><p class="leg">' + esc(i.legenda) + '</p>' +
    (i.canal === 'tiktok' ? '<button class="copiar" data-id="' + i.id + '">Copiar legenda</button>' : '') + '</details>' : '';
  const qtd = i.tipo === 'story' ? ' · ' + i.n + ' quadros' : i.tipo === 'carousel' ? ' · ' + i.n + ' telas' : '';
  return '<div class="item"><div class="hora">' + i.hora + '</div><div class="meio"><div class="linha"><span class="canal ' + i.canal + '">' + (i.canal === 'tiktok' ? 'TikTok' : 'Instagram') + '</span><span class="tipo">' + i.rotulo + qtd + '</span><span class="tit">' + esc(i.titulo) + (i.nota ? ' (reenvio)' : '') + '</span></div>' +
    '<div class="thumbs">' + i.thumbs.filter(Boolean).slice(0, 6).map((t) => '<img alt="" src="' + t + '">').join('') + '</div></div><span class="pill ' + i.sit.k + '">' + i.sit.t + '</span>' + leg + '</div>';
}
function cabecaDia(d) {
  const x = new Date(d + 'T12:00:00Z');
  return '<div class="data' + (d === D.hoje ? ' hoje' : '') + '"><span class="n">' + d.slice(8) + '</span><span class="m">' + D.meses[x.getUTCMonth()] + '</span><span class="s">' + D.dias[x.getUTCDay()] + '</span>' + (d === D.hoje ? '<span class="tag">hoje</span>' : '') + '</div>';
}
function porDia(lista, invertido) {
  const g = {};
  for (const i of lista) (g[i.dia] ||= []).push(i);
  const ks = Object.keys(g).sort(); if (invertido) ks.reverse();
  return ks.map((d) => '<section class="dia">' + cabecaDia(d) + '<div class="lista">' + g[d].map(cartao).join('') + '</div></section>').join('');
}
function render() {
  document.querySelectorAll('.aba').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === aba)));
  document.querySelectorAll('.filtro').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === filtro)));
  $('#filtros').hidden = aba === 'notion';
  const f = (l) => (filtro === 'todos' ? l : l.filter((i) => i.canal === filtro));
  let h = '';
  if (aba === 'prox') h = porDia(f(futuros)) || '<p class="vazio">Nada programado.</p>';
  else if (aba === 'saiu') h = porDia(f(saidos), true) || '<p class="vazio">Nada publicado ainda.</p>';
  else h = D.pendNotion.length ? '<p class="aviso">Itens do Notion com data daqui pra frente que ainda não estão no agendador. A maioria espera arquivo ou legenda.</p><div class="tbl"><table class="notion"><thead><tr><th>Dia</th><th>Item</th><th>Tipo</th><th>Arquivo</th></tr></thead><tbody>' +
    D.pendNotion.map((n) => '<tr><td>' + n.d.slice(8) + '/' + n.d.slice(5, 7) + '</td><td>' + esc(n.nome) + '</td><td>' + esc(n.tipo) + '</td><td>' + (n.arq ? '<span class="pill ok">tem arquivo</span>' : '<span class="pill erro">sem arquivo</span>') + '</td></tr>').join('') + '</tbody></table></div>'
    : '<p class="vazio">Tudo do Notion já está no agendador.</p>';
  $('#conteudo').innerHTML = h;
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('.aba'); if (a) { aba = a.dataset.aba; try { localStorage.setItem('aba', aba); } catch {} render(); return; }
  const fl = e.target.closest('.filtro'); if (fl) { filtro = fl.dataset.f; render(); return; }
  const c = e.target.closest('.copiar');
  if (c) {
    const i = D.itens.find((x) => x.id === c.dataset.id);
    navigator.clipboard.writeText(i.legenda).then(() => { c.textContent = 'Copiada'; }, () => {
      const p = c.previousElementSibling; const r = document.createRange(); r.selectNodeContents(p); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); c.textContent = 'Selecionada: use Copiar';
    });
  }
});
render();
</script>
`;
writeFileSync('painel.html', html);
console.log(`painel.html: ${itens.length} cartões, ${(html.length / 1024).toFixed(0)} KB`);
