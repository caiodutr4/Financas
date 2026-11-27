/* dutr4 finanças: tela Importar (extrato OFX e faturas CSV/XLS/PDF). */
(function () {
  const $ = id => document.getElementById(id);
  const M = window.ImportarMotor;
  const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dataBR = s => s.split('-').reverse().join('/');

  const LIBS = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  };
  const carregadas = {};
  function carregar(url) {
    if (!carregadas[url]) carregadas[url] = new Promise((ok, falha) => {
      const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => falha(new Error('Não consegui carregar o leitor de arquivo. Confira a internet.'));
      document.head.appendChild(s);
    });
    return carregadas[url];
  }

  let hist = null;       // { listas, linhas }
  let lidos = [];        // itens crus do arquivo
  let tipoArq = '';      // 'extrato' | 'fatura'
  let linhasPDF = null;  // texto do PDF, para reler se o fechamento mudar
  let itens = [];        // itens classificados
  let envioBase = '';    // mesmo id em novas tentativas: o script não grava duas vezes

  async function abrir() {
    if (hist) return;
    $('i-msg').textContent = 'Carregando o histórico para aprender as categorias...';
    try {
      const d = await App.chamar({ acao: 'historico' });
      if (!d.ok) { $('i-msg').textContent = d.erro === 'Ação desconhecida: historico' ? 'O script da planilha ainda é o antigo. Atualize o Apps Script para usar a importação.' : d.erro; return; }
      hist = d;
      const sel = $('i-conta'); sel.innerHTML = '';
      d.listas.contas.forEach(c => { const o = document.createElement('option'); o.value = o.textContent = c; sel.appendChild(o); });
      $('i-msg').textContent = '';
    } catch (e) { $('i-msg').textContent = 'Sem conexão. Tente de novo.'; }
  }

  /* ---------- leitura do arquivo ---------- */
  async function textoPDF(buf) {
    await carregar(LIBS.pdf);
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
    const doc = await lib.getDocument({ data: buf }).promise;
    const linhas = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pag = await doc.getPage(p);
      const tc = await pag.getTextContent();
      const porY = {};
      tc.items.forEach(i => { if (!i.str.trim()) return; const y = Math.round(i.transform[5] / 3) * 3; (porY[y] = porY[y] || []).push(i); });
      Object.keys(porY).map(Number).sort((a, b) => b - a).forEach(y => {
        linhas.push(porY[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' '));
      });
    }
    return linhas;
  }

  async function lerArquivo(arq) {
    const nome = arq.name.toLowerCase();
    const buf = await arq.arrayBuffer();
    linhasPDF = null;
    if (/\.ofx$/.test(nome)) { tipoArq = 'extrato'; return M.lerOFX(M.decodificar(buf)); }
    if (/\.pdf$/.test(nome)) {
      tipoArq = 'fatura'; linhasPDF = await textoPDF(buf);
      return M.lerTextoFatura(linhasPDF, $('i-fech').value || '');
    }
    if (/\.(xls|xlsx)$/.test(nome)) {
      await carregar(LIBS.xlsx);
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      const r = M.lerTabela(linhas); tipoArq = r.some(i => i.final) ? 'fatura' : 'extrato'; return r;
    }
    const texto = M.decodificar(buf);
    if (/<OFX>|<STMTTRN>/i.test(texto)) { tipoArq = 'extrato'; return M.lerOFX(texto); }
    const r = M.lerTabela(M.lerCSV(texto)); tipoArq = r.some(i => i.final || i.parcela) ? 'fatura' : 'extrato'; return r;
  }

  $('i-arquivo').onchange = async () => {
    const arq = $('i-arquivo').files[0];
    if (!arq) return;
    await abrir();
    if (!hist) return;
    $('i-revisao').innerHTML = ''; $('i-msg').textContent = 'Lendo ' + arq.name + '...';
    $('i-fech').value = '';
    try {
      lidos = await lerArquivo(arq);
      if (!lidos.length) { $('i-msg').textContent = 'Não encontrei lançamentos neste arquivo. Se for PDF, tente o CSV da fatura.'; return; }
      const contas = hist.listas.contas;
      $('i-conta').value = tipoArq === 'fatura' ? (contas.find(c => /C6/i.test(c)) || contas[0]) : (contas.find(c => /Pix|D[eé]bito/i.test(c)) || contas[0]);
      $('i-fech-l').hidden = $('i-fech-nota').hidden = tipoArq !== 'fatura';
      if (tipoArq === 'fatura' && !$('i-fech').value) $('i-fech').value = M.sugerirFechamento(lidos);
      if (linhasPDF) lidos = M.lerTextoFatura(linhasPDF, $('i-fech').value);
      $('i-opcoes').hidden = false;
      $('i-msg').textContent = '';
      processar();
    } catch (e) { $('i-msg').textContent = 'Não consegui ler: ' + e.message; }
  };
  $('i-conta').onchange = () => lidos.length && processar();
  $('i-fech').onchange = () => { if (!lidos.length) return; if (linhasPDF) lidos = M.lerTextoFatura(linhasPDF, $('i-fech').value); processar(); };

  /* ---------- classificação e revisão ---------- */
  function processar() {
    itens = M.classificar(lidos, { conta: $('i-conta').value, fechamento: tipoArq === 'fatura' ? $('i-fech').value : '', historico: hist.linhas, listas: hist.listas });
    M.marcarDuplicados(itens, hist.linhas);
    envioBase = Date.now().toString(36) + Math.random().toString(36).slice(2);
    itens.forEach((it, i) => {
      it.n = i;
      it.grupo = it.ignorar ? 'ignorado' : it.duplicado ? 'duplicado' : (it.duvida || it.talvezDuplicado) ? 'revisar' : 'ok';
      it.incluir = it.grupo === 'ok' || (it.grupo === 'revisar' && !it.talvezDuplicado);
    });
    desenhar();
  }

  function opts(lista, atual) { return lista.map(x => `<option${x === atual ? ' selected' : ''}>${esc(x)}</option>`).join(''); }

  function cartao(it) {
    const L = hist.listas;
    const aviso = it.talvezDuplicado ? `Pode já estar lançado: "${esc(it.talvezDuplicado.descricao)}" em ${dataBR(it.talvezDuplicado.data)}. Marque só se for outro gasto.`
      : it.duplicado ? `Já lançado como "${esc(it.duplicado.descricao)}" em ${dataBR(it.duplicado.data)}.`
      : it.ignorar ? esc(it.ignorar) : esc(it.duvida || '');
    const editavel = it.grupo === 'revisar' ? ' aberto' : '';
    return `<div class="imp${editavel}" data-n="${it.n}">
      <label class="imp-topo"><input type="checkbox" data-c="incluir"${it.incluir ? ' checked' : ''}>
        <span class="imp-d">${esc(it.descricao)}</span><b class="${it.tipo === 'Despesa' ? '' : 'neg'}">${it.tipo === 'Despesa' ? '' : esc(it.tipo) + ' '}${brl(it.valor)}</b></label>
      <div class="imp-m">${dataBR(it.data)} · ${esc(it.quem)}${it.parcelas ? ' · ' + esc(it.obs.split(';')[0]) : ''}</div>
      ${aviso ? `<div class="imp-aviso">${aviso}</div>` : ''}
      <div class="imp-campos">
        <select data-c="categoria" aria-label="Categoria">${opts(L.categorias, it.categoria)}</select>
        <select data-c="tipo" aria-label="Tipo">${opts(L.tipos, it.tipo)}</select>
        <select data-c="quem" aria-label="Quem">${opts(L.quem, it.quem)}</select>
        <input data-c="descricao" aria-label="Descrição" value="${esc(it.descricao)}">
      </div>
    </div>`;
  }

  function desenhar() {
    const g = n => itens.filter(i => i.grupo === n);
    const rev = g('revisar'), ok = g('ok'), dup = g('duplicado'), ign = g('ignorado');
    const soma = itens.filter(i => !i.ignorar).reduce((s, i) => s + (i.tipo === 'Reembolso' && tipoArq === 'fatura' ? -i.valor : i.valor), 0);
    const bloco = (titulo, lista, aberto, nota) => lista.length ? `<details class="imp-grupo"${aberto ? ' open' : ''}><summary><b>${titulo}</b> (${lista.length})</summary>${nota ? `<p class="nota">${nota}</p>` : ''}${lista.map(cartao).join('')}</details>` : '';
    $('i-revisao').innerHTML =
      `<div class="kpis">
        <div><small>Lidos no arquivo</small><b>${itens.length}</b></div>
        <div><small>Para revisar</small><b>${rev.length}</b></div>
        <div><small>Classificados sozinhos</small><b>${ok.length}</b></div>
        <div><small>Já lançados ou ignorados</small><b>${dup.length + ign.length}</b></div>
      </div>
      ${tipoArq === 'fatura' ? `<p class="nota">Soma das compras menos estornos: <b>${brl(soma)}</b>. Confira com o total da fatura.</p>` : ''}
      ${bloco('Para revisar', rev, true, 'Ajuste a categoria e o tipo. Desmarque o que não deve entrar.')}
      ${bloco('Classificados automaticamente', ok, false, 'Toque para conferir ou mudar algum.')}
      ${bloco('Já lançados', dup, false, 'Ficam de fora para não contar em dobro.')}
      ${bloco('Ignorados', ign, false, 'Pagamento de fatura e movimentos de investimento ficam de fora.')}
      <button class="primario" id="i-gravar"></button>
      <p id="i-msg2" class="msg" role="status"></p>`;
    contar();
    $('i-gravar').onclick = gravar;
  }

  function contar() {
    const n = itens.filter(i => i.incluir).length;
    const b = $('i-gravar'); if (!b) return;
    b.textContent = n ? `Gravar ${n} lançamento${n > 1 ? 's' : ''}` : 'Nada marcado para gravar';
    b.disabled = !n;
  }

  $('i-revisao').addEventListener('change', ev => {
    const el = ev.target, card = el.closest('.imp'); if (!card) return;
    const it = itens[+card.dataset.n], c = el.dataset.c;
    if (c === 'incluir') { it.incluir = el.checked; contar(); return; }
    if (c) {
      it[c] = el.value;
      if (c === 'tipo' || c === 'categoria') {
        const v = card.querySelector('.imp-topo b');
        v.className = it.tipo === 'Despesa' ? '' : 'neg';
        v.textContent = (it.tipo === 'Despesa' ? '' : it.tipo + ' ') + brl(it.valor);
      }
      if (!it.incluir && !it.ignorar && !it.duplicado) { it.incluir = true; card.querySelector('[data-c=incluir]').checked = true; contar(); }
    }
  });

  async function gravar() {
    const sel = itens.filter(i => i.incluir);
    if (!sel.length) return;
    const pend = sel.filter(i => i.grupo === 'revisar' && i.categoria === 'Outros' && !i.ignorar).length;
    const b = $('i-gravar'); b.disabled = true;
    const msg = $('i-msg2');
    const lote = sel.map(i => {
      let obs = i.obs;
      if (i.categoria === 'Outros' && i.tipo === 'Despesa') obs = (obs ? obs + '; ' : '') + 'Categoria a confirmar';
      return { data: i.data, valor: i.valor, descricao: i.descricao, conta: i.conta, categoria: i.categoria, quem: i.quem, tipo: i.tipo, parcelas: i.parcelas, obs };
    });
    let total = 0;
    try {
      for (let k = 0; k < lote.length; k += 200) {
        msg.textContent = `Gravando ${Math.min(k + 200, lote.length)} de ${lote.length}...`;
        const d = await App.chamar({ acao: 'adicionarLote', itens: lote.slice(k, k + 200), id: envioBase + '-' + sel.length + '-' + k });
        if (!d.ok) throw new Error(d.erro);
        total += d.gravados || 0;
      }
      msg.textContent = `Pronto: ${total} lançamento${total === 1 ? '' : 's'} gravado${total === 1 ? '' : 's'} na planilha.` + (pend ? ` ${pend} ${pend === 1 ? 'ficou' : 'ficaram'} em "Outros" para classificar depois.` : '');
      b.textContent = 'Gravado';
      hist = null; lidos = []; $('i-arquivo').value = '';
      await App.aposGravar();
      await abrir();
    } catch (e) {
      msg.textContent = 'Não gravou tudo: ' + e.message + (total ? ` (${total} já foram gravados). Toque em Gravar de novo: o que já entrou não é gravado duas vezes.` : '');
      b.disabled = false;
    }
  }

  window.Importar = { abrir };
})();
