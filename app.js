(function () {
  const $ = id => document.getElementById(id);
  const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const pct = (v, t) => t > 0 ? (v / t * 100).toFixed(1).replace('.', ',') + '%' : '0,0%';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const nomeMes = ym => { const [a, m] = ym.split('-'); return NOMES[+m - 1] + ' de ' + a; };
  const curto = ym => { const [a, m] = ym.split('-'); return NOMES[+m - 1].slice(0, 3) + '/' + a.slice(2); };
  const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const dataBR = s => s.split('-').reverse().slice(0, 2).join('/');
  const dataBRfull = s => s.split('-').reverse().join('/');
  const abrev = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.', ',') + 'k' : String(Math.round(n));

  let senha = '', usuario = '', tipo = 'Despesa', primeiraVez = true;
  try { senha = localStorage.getItem('dutr4_senha') || ''; } catch (e) {}
  let cache = {};          // dados por tela
  let idEnvio = '', ultimoItem = '';
  let mesSel = '';         // mês escolhido no Resumo

  async function chamar(corpo) {
    const r = await fetch(URL_SCRIPT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ senha, ...corpo }) });
    return r.json();
  }
  function tela(nome) {
    $('login').hidden = nome !== 'login';
    $('app').hidden = nome !== 'app';
    $('nav').hidden = nome !== 'app';
    $('sair').hidden = nome !== 'app';
    $('usuario').textContent = nome === 'app' ? usuario : '';
  }
  function vista(v) {
    ['lancar', 'resumo', 'importar', 'ativos'].forEach(n => { $('v-' + n).hidden = n !== v; });
    document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
    window.scrollTo(0, 0);
    if (v === 'resumo') carregaResumo(mesSel);
    if (v === 'ativos') carregaAtivos();
    if (v === 'importar' && window.Importar) window.Importar.abrir();
  }

  /* ---------- Lançar ---------- */
  function opcoes(sel, lista) {
    const ant = sel.value;
    sel.innerHTML = '';
    lista.forEach(x => { const o = document.createElement('option'); o.value = o.textContent = x; sel.appendChild(o); });
    if (lista.includes(ant)) sel.value = ant;
  }
  function desenhaTipos(tipos) {
    const box = $('tipos'); box.innerHTML = '';
    tipos.forEach(t => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t;
      b.setAttribute('aria-pressed', t === tipo);
      b.onclick = () => { tipo = t; desenhaTipos(tipos); };
      box.appendChild(b);
    });
  }
  function barras(itens, total, larga) {
    const max = Math.max(1, ...itens.map(c => c.valor));
    return itens.map(c => `<div class="cat ${larga ? 'larga' : ''}"><span>${esc(c.nome)}${total ? ` <small>${pct(c.valor, total)}</small>` : ''}</span><span class="barra"><i style="width:${(c.valor / max * 100).toFixed(0)}%"></i></span><span>${brl(c.valor)}</span></div>`).join('');
  }
  function mostraLancar(d) {
    const L = d.listas;
    opcoes($('categoria'), L.categorias); opcoes($('quem'), L.quem); opcoes($('conta'), L.contas);
    if (primeiraVez && L.quem.includes(usuario)) $('quem').value = usuario;
    primeiraVez = false;
    if (!L.tipos.includes(tipo)) tipo = L.tipos[0];
    desenhaTipos(L.tipos);
    $('titulo-mes').textContent = nomeMes(d.mes.ref);
    const liq = d.mes.Despesa - d.mes.Reembolso;
    $('totais').innerHTML = [['Despesa líquida', liq], ['Receitas', d.mes.Receita], ['Resultado', d.mes.Receita - liq], ['Aportes', d.mes.Aporte]]
      .map(([k, v]) => `<div><small>${k}</small><b>${brl(v)}</b></div>`).join('');
    $('cats').innerHTML = barras(d.categorias.map(c => ({ nome: c.categoria, valor: c.valor })), 0, false);
    $('recentes').innerHTML = d.recentes.map(r => `<li><span class="d">${esc(r.descricao)}</span><span class="v ${r.tipo === 'Despesa' ? '' : 'neg'}">${r.tipo === 'Despesa' ? '' : esc(r.tipo) + ' '}${brl(r.valor)}</span><span class="m">${dataBR(r.data)} · ${esc(r.categoria)} · ${esc(r.quem)}</span></li>`).join('');
  }

  /* ---------- Resumo ---------- */
  function graficoMensal(serie) {
    const W = 340, H = 170, base = 140, topo = 18;
    const max = Math.max(1, ...serie.flatMap(s => [s.despesa, s.receita]));
    const w = W / serie.length, bw = Math.min(18, w / 2 - 4);
    const y = v => base - (v / max) * (base - topo);
    let g = `<line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#000" stroke-width="1"/>`;
    serie.forEach((s, i) => {
      const cx = i * w + w / 2;
      const hd = Math.max(0, base - y(Math.max(0, s.despesa))), hr = Math.max(0, base - y(s.receita));
      g += `<rect x="${cx - bw - 1}" y="${base - hd}" width="${bw}" height="${hd}" fill="#000"/>`;
      g += `<rect x="${cx + 1}" y="${base - hr}" width="${bw}" height="${hr}" fill="#bdbdbd"/>`;
      g += `<text x="${cx - bw / 2 - 1}" y="${base - hd - 4}" font-size="9" text-anchor="middle" fill="#000">${s.despesa > 0 ? abrev(s.despesa) : ''}</text>`;
      g += `<text x="${cx + bw / 2 + 1}" y="${base - hr - 4}" font-size="9" text-anchor="middle" fill="#666">${s.receita > 0 ? abrev(s.receita) : ''}</text>`;
      g += `<text x="${cx}" y="${base + 16}" font-size="10" text-anchor="middle" fill="#000">${curto(s.mes)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" font-family="Ubuntu, system-ui, sans-serif" role="img" aria-label="Despesa líquida e receitas dos últimos meses">${g}</svg>`;
  }
  function delta(atual, anterior) {
    if (!(anterior > 0)) return '';
    const p = (atual - anterior) / anterior * 100;
    return (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(0) + '% vs mês anterior';
  }
  function mostraResumo(d) {
    mesSel = d.mes;
    const sel = $('mes-sel'); sel.innerHTML = '';
    d.meses.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = nomeMes(m); sel.appendChild(o); });
    sel.value = d.mes;
    const i = d.meses.indexOf(d.mes);
    $('mes-prox').disabled = i <= 0;
    $('mes-ant').disabled = i >= d.meses.length - 1;
    $('aviso-mes').textContent = d.emAndamento ? 'Mês em andamento: os números ainda vão mudar.' : '';
    const t = d.tot, a = d.ant;
    const liq = t.Despesa - t.Reembolso, liqA = a.Despesa - a.Reembolso;
    const res = t.Receita - liq;
    const kpi = (k, v, extra, forte) => `<div class="${forte ? 'forte' : ''}"><small>${k}</small><b>${brl(v)}</b>${extra ? `<em>${extra}</em>` : ''}</div>`;
    const totalDesp = d.porCategoria.reduce((s, c) => s + c.valor, 0);
    $('r-conteudo').innerHTML =
      `<div class="kpis">${kpi('Resultado do mês', res, 'Receitas menos despesa líquida', true)}
        ${kpi('Despesa líquida', liq, delta(liq, liqA))}${kpi('Receitas', t.Receita, delta(t.Receita, a.Receita))}
        ${kpi('Reembolsos', t.Reembolso, '')}${kpi('Aportes', t.Aporte, 'Após aportes: <span style="white-space:nowrap">' + brl(res - t.Aporte) + '</span>')}</div>
      <h2>Últimos 6 meses</h2>
      <div class="grafico"><div class="legenda"><span><i style="background:#000"></i>Despesa líquida</span><span><i style="background:#bdbdbd"></i>Receitas</span></div>${graficoMensal(d.serie)}</div>
      <h2>Despesas por categoria</h2>
      <div class="grafico">${d.porCategoria.length ? barras(d.porCategoria, totalDesp, true) : '<p class="vazio">Sem despesas neste mês.</p>'}</div>
      <h2>Por pessoa</h2>
      <div class="grafico">${d.porQuem.length ? barras(d.porQuem, totalDesp, true) : '<p class="vazio">Sem dados.</p>'}</div>
      <h2>Por conta ou cartão</h2>
      <div class="grafico">${d.porConta.length ? barras(d.porConta, totalDesp, true) : '<p class="vazio">Sem dados.</p>'}</div>`;
  }
  async function carregaResumo(mes) {
    const chave = 'resumo-' + (mes || 'atual');
    if (cache[chave]) { mostraResumo(cache[chave]); return; }
    $('r-conteudo').innerHTML = '<p class="vazio">Carregando...</p>';
    try {
      const d = await chamar({ acao: 'resumo', mes });
      if (!d.ok) { $('r-conteudo').innerHTML = `<p class="erro">${esc(d.erro)}</p>`; return; }
      cache[chave] = d; mostraResumo(d);
    } catch (e) { $('r-conteudo').innerHTML = '<p class="erro">Sem conexão. Tente de novo.</p>'; }
  }
  $('mes-sel').onchange = () => carregaResumo($('mes-sel').value);
  $('mes-ant').onclick = () => { const o = $('mes-sel').options, i = $('mes-sel').selectedIndex; if (i < o.length - 1) carregaResumo(o[i + 1].value); };
  $('mes-prox').onclick = () => { const o = $('mes-sel').options, i = $('mes-sel').selectedIndex; if (i > 0) carregaResumo(o[i - 1].value); };

  /* ---------- Ativos e aportes ---------- */
  function mostraAtivos(d) {
    const cron = d.cronograma.length ? `<h2>Recebimentos previstos</h2><div class="grafico">${barras(d.cronograma.map(c => ({ nome: c.periodo, valor: c.valor })), 0, false)}</div>` : '';
    $('a-conteudo').innerHTML =
      `<p class="grande">${brl(d.total)}</p>
      <h2>Por tipo</h2><div class="grafico">${barras(d.porTipo, d.total, true)}</div>
      <h2>Itens</h2><div class="grafico">${d.itens.map(i => `<div class="item"><div class="topo"><span>${esc(i.item)}</span><b>${brl(i.valor)}</b></div><div class="m">${esc(i.tipo)} · ${esc(i.quem)}</div>${i.obs ? `<details><summary>Detalhes</summary><p>${esc(i.obs)}</p></details>` : ''}</div>`).join('')}</div>
      ${cron}
      <h2>Aportes lançados</h2>
      <p class="nota">Total: ${brl(d.totalAportes)}</p>
      <ul class="lista">${d.aportes.length ? d.aportes.map(r => `<li><span class="d">${esc(r.descricao)}</span><span class="v">${brl(r.valor)}</span><span class="m">${dataBRfull(r.data)} · ${esc(r.conta)}</span></li>`).join('') : '<li class="vazio">Nenhum aporte lançado ainda.</li>'}</ul>
      <p class="nota">Os valores dos ativos são editados na aba Ativos da planilha.</p>`;
  }
  async function carregaAtivos() {
    if (cache.ativos) { mostraAtivos(cache.ativos); return; }
    $('a-conteudo').innerHTML = '<p class="vazio">Carregando...</p>';
    try {
      const d = await chamar({ acao: 'ativos' });
      if (!d.ok) { $('a-conteudo').innerHTML = `<p class="erro">${esc(d.erro)}</p>`; return; }
      cache.ativos = d; mostraAtivos(d);
    } catch (e) { $('a-conteudo').innerHTML = '<p class="erro">Sem conexão. Tente de novo.</p>'; }
  }

  /* ---------- Entrada e lançamento ---------- */
  async function iniciar() {
    if (!senha) return tela('login');
    try {
      const d = await chamar({ acao: 'iniciar' });
      if (!d.ok) { $('erro-login').textContent = d.erro; try { localStorage.removeItem('dutr4_senha'); } catch (e) {} senha = ''; return tela('login'); }
      usuario = d.usuario; $('data').value = hojeISO(); cache = {}; mostraLancar(d); tela('app'); vista('lancar');
    } catch (e) { $('erro-login').textContent = 'Sem conexão. Tente de novo.'; tela('login'); }
  }
  $('f-login').onsubmit = ev => { ev.preventDefault(); senha = $('senha').value; $('erro-login').textContent = ''; try { localStorage.setItem('dutr4_senha', senha); } catch (e) {} iniciar(); };
  $('sair').onclick = () => { try { localStorage.removeItem('dutr4_senha'); } catch (e) {} senha = ''; usuario = ''; primeiraVez = true; $('senha').value = ''; tela('login'); };
  document.querySelectorAll('#nav button').forEach(b => { b.onclick = () => vista(b.dataset.v); });

  $('f-novo').onsubmit = async ev => {
    ev.preventDefault();
    const valor = parseFloat($('valor').value.replace(/\./g, '').replace(',', '.'));
    if (!(valor > 0)) { $('msg').textContent = 'Informe um valor maior que zero.'; return; }
    const item = { valor, descricao: $('descricao').value, categoria: $('categoria').value, quem: $('quem').value, conta: $('conta').value, data: $('data').value, tipo, parcelas: $('parcelas').value, obs: $('obs').value };
    const assinatura = JSON.stringify(item);
    if (assinatura !== ultimoItem) { ultimoItem = assinatura; idEnvio = Date.now().toString(36) + Math.random().toString(36).slice(2); }
    $('salvar').disabled = true; $('msg').textContent = 'Salvando...';
    try {
      const d = await chamar({ acao: 'adicionar', item, id: idEnvio });
      if (!d.ok) { $('msg').textContent = 'Não salvou: ' + d.erro; }
      else { ultimoItem = ''; $('msg').textContent = 'Salvo.'; ['valor', 'descricao', 'parcelas', 'obs'].forEach(i => $(i).value = ''); cache = {}; mostraLancar(d); $('valor').focus(); }
    } catch (e) { $('msg').textContent = 'Sem conexão. Não salvou, tente de novo.'; }
    $('salvar').disabled = false;
  };

  // Usado pela tela Importar
  window.App = {
    chamar, usuario: () => usuario,
    aposGravar: async () => { cache = {}; try { const d = await chamar({ acao: 'iniciar' }); if (d.ok) mostraLancar(d); } catch (e) {} }
  };

  iniciar();
})();
