(function () {
  const $ = id => document.getElementById(id);
  const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const dataBR = s => s.split('-').reverse().slice(0, 2).join('/');
  let senha = '';
  try { senha = localStorage.getItem('dutr4_senha') || ''; } catch (e) {}
  let tipo = 'Despesa';

  async function chamar(corpo) {
    const r = await fetch(URL_SCRIPT, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ senha, ...corpo }) });
    return r.json();
  }
  function tela(nome) { $('login').hidden = nome !== 'login'; $('app').hidden = nome !== 'app'; $('sair').hidden = nome !== 'app'; }

  function opcoes(sel, lista, atual) {
    const ant = atual || sel.value;
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
  function mostra(d) {
    const L = d.listas;
    opcoes($('categoria'), L.categorias); opcoes($('quem'), L.quem); opcoes($('conta'), L.contas);
    if (!L.tipos.includes(tipo)) tipo = L.tipos[0];
    desenhaTipos(L.tipos);
    const [a, m] = d.mes.ref.split('-');
    const nomes = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    $('titulo-mes').textContent = nomes[+m - 1] + ' de ' + a;
    const liq = d.mes.Despesa - d.mes.Reembolso;
    $('totais').innerHTML = [['Despesa líquida', liq], ['Receitas', d.mes.Receita], ['Resultado', d.mes.Receita - liq], ['Aportes', d.mes.Aporte]]
      .map(([k, v]) => `<div><small>${k}</small><b>${brl(v)}</b></div>`).join('');
    const max = Math.max(1, ...d.categorias.map(c => c.valor));
    $('cats').innerHTML = d.categorias.map(c => `<div class="cat"><span>${esc(c.categoria)}</span><span class="barra"><i style="width:${(c.valor / max * 100).toFixed(0)}%"></i></span><span>${brl(c.valor)}</span></div>`).join('');
    $('recentes').innerHTML = d.recentes.map(r => `<li><span class="d">${esc(r.descricao)}</span><span class="v ${r.tipo === 'Despesa' ? '' : 'neg'}">${r.tipo === 'Despesa' ? '' : esc(r.tipo) + ' '}${brl(r.valor)}</span><span class="m">${dataBR(r.data)} · ${esc(r.categoria)} · ${esc(r.quem)}</span></li>`).join('');
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  async function iniciar() {
    if (!senha) return tela('login');
    try {
      const d = await chamar({ acao: 'iniciar' });
      if (!d.ok) { $('erro-login').textContent = d.erro; try { localStorage.removeItem('dutr4_senha'); } catch (e) {} senha = ''; return tela('login'); }
      $('data').value = hojeISO(); mostra(d); tela('app');
    } catch (e) { $('erro-login').textContent = 'Sem conexão. Tente de novo.'; tela('login'); }
  }

  $('f-login').onsubmit = ev => { ev.preventDefault(); senha = $('senha').value; $('erro-login').textContent = ''; try { localStorage.setItem('dutr4_senha', senha); } catch (e) {} iniciar(); };
  $('sair').onclick = () => { try { localStorage.removeItem('dutr4_senha'); } catch (e) {} senha = ''; $('senha').value = ''; tela('login'); };

  $('f-novo').onsubmit = async ev => {
    ev.preventDefault();
    const valor = parseFloat($('valor').value.replace(/\./g, '').replace(',', '.'));
    if (!(valor > 0)) { $('msg').textContent = 'Informe um valor maior que zero.'; return; }
    const item = { valor, descricao: $('descricao').value, categoria: $('categoria').value, quem: $('quem').value, conta: $('conta').value, data: $('data').value, tipo, parcelas: $('parcelas').value, obs: $('obs').value };
    $('salvar').disabled = true; $('msg').textContent = 'Salvando...';
    try {
      const d = await chamar({ acao: 'adicionar', item });
      if (!d.ok) { $('msg').textContent = 'Não salvou: ' + d.erro; }
      else { $('msg').textContent = 'Salvo.'; ['valor', 'descricao', 'parcelas', 'obs'].forEach(i => $(i).value = ''); mostra(d); $('valor').focus(); }
    } catch (e) { $('msg').textContent = 'Sem conexão. Não salvou, tente de novo.'; }
    $('salvar').disabled = false;
  };

  iniciar();
})();
