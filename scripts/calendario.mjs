// Gera CALENDARIO.md (só local) a partir de schedule.json + published.json.
// Uso: node scripts/calendario.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const s = JSON.parse(readFileSync('schedule.json', 'utf8'));
const pub = existsSync('published.json') ? JSON.parse(readFileSync('published.json', 'utf8')) : {};
const dias = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const tipo = { image: 'Post (imagem)', carousel: 'Carrossel', story: 'Story', reel: 'Reel', tiktok_rascunho: 'TikTok (rascunho)', tiktok_studio: 'TikTok (Studio)' };
const tz = 'America/Sao_Paulo';

let md = `# Calendário do agendador Jogaleria\n\nAtualizado em ${new Date().toLocaleString('pt-BR', { timeZone: tz })} (horário de Brasília)\n\n`;
md += '| Dia | Hora | Tipo | Quadros | Situação | Item |\n|---|---|---|---|---|---|\n';

for (const i of s) {
  const d = new Date(i.when);
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const dow = dias[new Date(d.toLocaleString('en-US', { timeZone: tz })).getDay()];
  const st = i.studio ? (Date.parse(i.when) <= Date.now() ? '✅ publicado no TikTok' : '🕒 programado no TikTok') : pub[i.id]?.mediaId ? '✅ publicado' : pub[i.id]?.erro ? `⚠️ erro: ${pub[i.id].erro.slice(0, 60)}` : i.enabled === false ? '⏸ desligado' : '🕒 agendado';
  md += `| ${dow} ${p.day}/${p.month} | ${p.hour}:${p.minute} | ${tipo[i.type]} | ${i.files.length} | ${st} | ${i.id.replace(/^\d{4}-\d{2}-\d{2}-/, '')} |\n`;
}

// Próximas do Notion que ainda não estão no agendador (lista salva em notion-proximas.json, só local).
if (existsSync('notion-proximas.json')) {
  const prox = JSON.parse(readFileSync('notion-proximas.json', 'utf8'));
  const ids = new Set(s.map((i) => i.notion).filter(Boolean));
  md += '\n## Próximas no Notion (ainda não agendadas)\n\n| Dia | Tipo | Canal | Arquivos | Item |\n|---|---|---|---|---|\n';
  for (const n of prox) {
    if (ids.has(n.nome)) continue;
    const dt = new Date(`${n.d}T12:00:00-03:00`);
    const dow = dias[dt.getUTCDay()];
    const arq = n.arquivos ? `${n.arquivos} ✅` : 'sem arquivo ⚠️';
    md += `| ${dow} ${n.d.slice(8, 10)}/${n.d.slice(5, 7)} | ${n.tipo} | ${n.canal} | ${arq} | ${n.nome} |\n`;
  }
}

md += '\n## Fora do calendário (falta material ou decisão)\n';
md += '- Post 07 Torre Esmaga (era 23/10, passou): legenda com espaço vazio e TikTok Shop não confirmado.\n';
md += '- Stories de 21, 22, 23 e 25/10: marcados a refazer / aguardam foto.\n';
md += '- Vídeos História 2 e 3: sem arquivo no Notion.\n';
writeFileSync('CALENDARIO.md', md);
console.log(md);
