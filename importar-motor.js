/* dutr4 finanças: leitura de extratos e faturas, classificação e detecção de duplicados.
   Tudo roda no navegador; nada do arquivo sai do aparelho além dos lançamentos confirmados. */
(function (raiz) {
  'use strict';

  /* ---------------- utilidades ---------------- */
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = s => semAcento(s).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const centavos = v => Math.round(Math.abs(v) * 100);
  const isoParaBR = s => s.split('-').reverse().join('/');
  const diasEntre = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5);

  function numeroBR(v) {
    if (typeof v === 'number') return v;
    let s = String(v || '').trim();
    if (!s) return NaN;
    let neg = /^-|-$|^\(.*\)$|\bD$/i.test(s.replace(/\s/g, ''));
    s = s.replace(/[^\d.,]/g, '');
    if (!s) return NaN;
    const ultV = s.lastIndexOf(','), ultP = s.lastIndexOf('.');
    if (ultV > ultP) s = s.replace(/\./g, '').replace(',', '.');
    else if (ultP > ultV && ultV >= 0) s = s.replace(/,/g, '');
    else if (ultV < 0 && (s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return isNaN(n) ? NaN : (neg ? -n : n);
  }

  const MESES = { JAN: 1, FEV: 2, FEB: 2, MAR: 3, ABR: 4, APR: 4, MAI: 5, MAY: 5, JUN: 6, JUL: 7, AGO: 8, AUG: 8, SET: 9, SEP: 9, OUT: 10, OCT: 10, NOV: 11, DEZ: 12, DEC: 12 };

  /** Converte vários formatos de data em AAAA-MM-DD. anoRef ajuda quando a data vem sem ano. */
  function dataISO(v, anoRef, mesRef) {
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
    if (typeof v === 'number' && v > 20000 && v < 80000) { // número de série do Excel
      const d = new Date(Math.round((v - 25569) * 864e5));
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    const s = semAcento(String(v || '')).trim().toUpperCase();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (m) { const a = m[3].length === 2 ? '20' + m[3] : m[3]; return a + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    let dia, mes;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})\b/);
    if (m) { dia = +m[1]; mes = +m[2]; }
    else { m = s.match(/^(\d{1,2})\s*(?:DE\s+)?([A-Z]{3})/); if (m && MESES[m[2]]) { dia = +m[1]; mes = MESES[m[2]]; } }
    if (dia && mes && anoRef) {
      let ano = anoRef;
      if (mesRef && mes > mesRef) ano--; // compra de dezembro numa fatura de janeiro
      return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    }
    return '';
  }

  function decodificar(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  }

  /* ---------------- OFX (extrato da conta) ---------------- */
  function lerOFX(texto) {
    const campo = (bloco, tag) => { const m = bloco.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
    const itens = [];
    const blocos = texto.split(/<STMTTRN>/i).slice(1);
    blocos.forEach(b => {
      b = b.split(/<\/STMTTRN>/i)[0];
      const dt = campo(b, 'DTPOSTED');
      const valor = numeroBR(campo(b, 'TRNAMT').replace(',', '.'));
      if (!dt || isNaN(valor) || !valor) return;
      const memo = campo(b, 'MEMO'), nome = campo(b, 'NAME');
      let desc = memo || nome;
      if (memo && nome && norm(memo).indexOf(norm(nome)) < 0 && norm(nome).indexOf(norm(memo)) < 0) desc = memo + ' ' + nome;
      itens.push({
        origem: 'extrato', data: dt.slice(0, 4) + '-' + dt.slice(4, 6) + '-' + dt.slice(6, 8),
        valorBruto: valor, valor: Math.abs(valor), descricao: desc.replace(/\s+/g, ' ').trim(), id: campo(b, 'FITID')
      });
    });
    return itens;
  }

  /* ---------------- CSV ---------------- */
  function lerCSV(texto) {
    texto = texto.replace(/^﻿/, '');
    const primeira = texto.split(/\r?\n/).find(l => l.trim()) || '';
    const sep = [';', '\t', ','].map(c => [c, primeira.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
    const linhas = []; let lin = [], cel = '', aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; }
        else if (c === '"') aspas = false;
        else cel += c;
      } else if (c === '"') aspas = true;
      else if (c === sep) { lin.push(cel); cel = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && texto[i + 1] === '\n') i++;
        lin.push(cel); cel = ''; if (lin.some(x => x.trim())) linhas.push(lin); lin = [];
      } else cel += c;
    }
    lin.push(cel); if (lin.some(x => x.trim())) linhas.push(lin);
    return linhas;
  }

  /* ---------------- Tabela (CSV ou planilha) ---------------- */
  /** Recebe linhas (arrays) e acha o cabeçalho e as colunas sozinho. */
  function lerTabela(linhas) {
    const H = linhas.map(l => l.map(c => norm(c instanceof Date ? '' : c)));
    let hi = H.findIndex(l => l.some(c => /DESCRI|ESTABELECIMENTO|HISTORICO|LANCAMENTO/.test(c)) && l.some(c => /VALOR|R \b|AMOUNT/.test(c)));
    if (hi < 0) throw new Error('Não achei o cabeçalho da tabela (colunas de data, descrição e valor).');
    const cab = H[hi];
    const acha = (...testes) => { for (const t of testes) { const i = cab.findIndex(c => t.test(c)); if (i >= 0) return i; } return -1; };
    const col = {
      data: acha(/DATA DE COMPRA/, /^DATA/, /DATE/),
      desc: acha(/DESCRI/, /ESTABELECIMENTO/, /HISTORICO/, /LANCAMENTO/),
      valor: acha(/VALOR.*R\b/, /^VALOR$/, /VALOR/, /AMOUNT/),
      usd: acha(/US\b/, /DOLAR/),
      cot: acha(/COTA/),
      parcela: acha(/PARCELA/),
      final: acha(/FINAL/),
      categoriaBanco: acha(/CATEGORIA/),
      nome: acha(/NOME/)
    };
    if (col.valor === col.usd) col.valor = acha(/VALOR EM R\b/, /VALOR R\b/, /^VALOR$/);
    if (col.data < 0 || col.desc < 0 || col.valor < 0) throw new Error('A tabela precisa ter colunas de data, descrição e valor.');
    const itens = [];
    let anoRef = new Date().getFullYear();
    for (let i = hi + 1; i < linhas.length; i++) {
      const l = linhas[i];
      const data = dataISO(l[col.data], anoRef);
      const valor = numeroBR(l[col.valor]);
      const desc = String(l[col.desc] || '').replace(/\s+/g, ' ').trim();
      if (!data || isNaN(valor) || !valor || !desc) continue;
      const it = { origem: 'fatura', data, valorBruto: valor, valor: Math.abs(valor), descricao: desc };
      if (col.parcela >= 0) it.parcela = String(l[col.parcela] || '').trim();
      if (col.final >= 0) it.final = String(l[col.final] || '').replace(/\D/g, '').slice(-4);
      if (col.usd >= 0) { const u = numeroBR(l[col.usd]); if (u && !isNaN(u)) it.usd = Math.abs(u); }
      if (col.cot >= 0) { const c = numeroBR(l[col.cot]); if (c && !isNaN(c)) it.cotacao = c; }
      if (col.categoriaBanco >= 0) it.categoriaBanco = String(l[col.categoriaBanco] || '').trim();
      if (col.nome >= 0) it.nomeCartao = String(l[col.nome] || '').trim();
      itens.push(it);
    }
    return itens;
  }

  /* ---------------- PDF (texto já extraído, uma linha por item) ---------------- */
  function lerTextoFatura(linhasTexto, fechamentoISO) {
    const anoRef = +(fechamentoISO || '').slice(0, 4) || new Date().getFullYear();
    const mesRef = +(fechamentoISO || '').slice(5, 7) || 12;
    const itens = [];
    let final = '';
    const reItem = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}\s+(?:de\s+)?[A-Za-zç]{3}[a-zç]*\.?)\s+(.+?)\s+(-\s*)?(?:R\$\s*)?(-?\s*\d{1,3}(?:\.\d{3})*,\d{2})(\s*-)?$/i;
    linhasTexto.forEach(bruta => {
      const lin = bruta.replace(/\s+/g, ' ').trim();
      const f = lin.match(/final\s*:?\s*(\d{4})/i);
      if (f && !reItem.test(lin)) { final = f[1]; return; }
      const m = lin.match(reItem);
      if (!m) return;
      let desc = m[2].trim();
      if (/^(total|subtotal|saldo|limite|valor|encargos|juros|multa|pagamento minimo)/i.test(desc)) return;
      const data = dataISO(m[1], anoRef, mesRef);
      let valor = numeroBR(m[4]);
      if (m[3] || m[5] || /^-/.test(m[4].trim())) valor = -Math.abs(valor);
      if (!data || isNaN(valor) || !valor) return;
      const it = { origem: 'fatura', data, valorBruto: valor, valor: Math.abs(valor), descricao: desc };
      const p = desc.match(/\s*(?:parcela\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i);
      if (p && +p[2] > 1 && +p[1] <= +p[2]) { it.parcela = p[1] + '/' + p[2]; it.descricao = desc.slice(0, p.index).replace(/\s*-\s*$/, '').trim(); }
      if (final) it.final = final;
      itens.push(it);
    });
    return itens;
  }

  /* ---------------- Aprendizado a partir do histórico ---------------- */
  const GENERICOS = new Set(['DL', 'MP', 'PG', 'EC', 'ZP', 'PAYGO', 'BPG', 'VMT', 'JIM', 'COM', 'IOF', 'EXTERIOR', 'PIX', 'TRANSF', 'TED', 'DOC', 'PAG', 'PGTO', 'COMPRA', 'DEB', 'DEBITO', 'CARTAO', 'SA', 'LTDA', 'DE', 'DA', 'DO', 'E']);
  function chaves(desc) {
    let n = norm(String(desc).replace(/^IOF exterior - /i, ''));
    const semNum = n.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
    const pal = semNum.split(' ').filter(Boolean);
    const sig = pal.filter(p => !GENERICOS.has(p) && p.length >= 2);
    return {
      k1: semNum,
      k2: pal.slice(0, 2).join(' '),
      k3: sig[0] && sig[0].length >= 3 ? sig[0] : ''
    };
  }

  function aprender(historico) {
    const mapas = { k1: {}, k2: {}, k3: {} };
    const finais = {};
    historico.forEach(r => {
      const f = (r.obs || '').match(/Cart[aã]o final (\d{4})/i);
      if (f && r.quem) { finais[f[1]] = finais[f[1]] || {}; finais[f[1]][r.quem] = (finais[f[1]][r.quem] || 0) + 1; }
      if (!r.categoria || r.categoria === 'Outros' || /confirmar/i.test(r.obs || '')) return;
      const k = chaves(r.descricao);
      ['k1', 'k2', 'k3'].forEach(n => {
        if (!k[n]) return;
        const m = mapas[n][k[n]] = mapas[n][k[n]] || { total: 0, cat: {}, tipo: {}, quem: {} };
        m.total++;
        m.cat[r.categoria] = (m.cat[r.categoria] || 0) + 1;
        m.tipo[r.tipo] = (m.tipo[r.tipo] || 0) + 1;
        m.quem[r.quem] = (m.quem[r.quem] || 0) + 1;
      });
    });
    const topo = o => Object.keys(o).sort((a, b) => o[b] - o[a])[0];
    const quemPorFinal = {};
    Object.keys(finais).forEach(f => quemPorFinal[f] = topo(finais[f]));
    return { mapas, quemPorFinal, topo };
  }

  /* ---------------- Regras por palavra-chave ---------------- */
  const REGRAS = [
    ['Assinaturas', /\b(NETFLIX|SPOTIFY|APPLE COM|GOOGLE ONE|YOUTUBE|YOUTUBEPREMIUM|AMAZON PRIME|PRIME VIDEO|HBO|HBOMAX|DISNEY|GLOBOPLAY|OPENAI|CHATGPT|SCRIBD|IFOOD CLUB|UBER ONE|ONE MEMBERSHIP|DEEZER|PARAMOUNT|SEGURO CONTA|VISION TELECOM|CLARO|VIVO|TIM CELULAR)\b/],
    ['Alimentação fora', /\b(99FOOD|IFOOD|IFD|RESTAURANTE|REST|PIZZ\w*|BURGER|LANCH\w*|PADARIA|PANIFICADORA|PANIFIC\w*|CAFE|CAFETERIA|SORVET\w*|GELATO|ACAI|DOCES|BOULANGERIE|SUSHI|CHURRASC\w*|GALETOS?|BAR|BISTRO|COZINHA|OUTBACK|MADERO|COCO)\b/],
    ['Transporte', /\b(UBER|UBERRIDES|99|99APP|99POP|TAXI|PATINETES?|ESTAC\w*|ESTACIONAMEN\w*|MULTIPARK|BRB MOBILIDA\w*|METRO|URENTCAR|PEDAGIO|SEM PARAR|VELOE|GUINCHO)\b/],
    ['Combustível', /\b(POSTO|COMBUST\w*|IPIRANGA|PETROBRAS|BR MANIA|GASOLINA|SHELL)\b/],
    ['Supermercado/Feira', /\b(SUPERMERC\w*|BIG BOX|PAO DE ACUCAR|COMPER|CARREFOUR|ASSAI|ATACAD\w*|HORTIFRUTI|OBA|CARNES|ACOUGUE|FEIRA|EMPORIO|DELI MARKET|SACOLAO)\b/],
    ['Saúde', /\b(DROGA\w*|FARMA\w*|DROGASIL|PACHECO|LABORAT\w*|SABIN|CLINICA|HOSPITAL|MEDIC\w*|ODONTO\w*|PSICO\w*|EXAME|UNIMED|AMIL)\b/],
    ['Educação e filhos', /\b(ESCOLA|COLEGIO|EDUCACIONAL|CANTINA|LIVRARIA|PAPELARIA|LEITURINHA|MONTESSORI|INFANTIL|RI HAPPY|BRINQUED\w*|CURSO)\b/],
    ['Casa e compras', /\b(SHOPEE|MERCADOLIVRE|MERCADO LIVRE|AMAZON|AMAZONMKTPLC|SHEIN|MAGAZINE|MAGALU|LEROY|FERRAG\w*|TINTAS|MULTICOISAS|RENNER|RIACHUELO|ZARA|CORTINAS|MOVEIS|UTILIDADES)\b/],
    ['Moradia', /\b(ALUGUEL|CONDOMINIO|IMOBILIARI\w*|DIARISTA|FAXINA|LAVANDERIA|NEOENERGIA|CEB|CAESB|ENERGIA|CONTA DE LUZ|AGUA|GAS)\b/],
    ['Cuidados pessoais', /\b(ESMALTERIA|SALAO|CABELEIREIR\w*|HAIR|BARBEARIA|BARBEIRO|NATURA|BOTICARIO|ESTETICA|MANICURE)\b/],
    ['Lazer e presentes', /\b(CINEMA|CINEMARK|INGRESSO\w*|SYMPLA|SHOW|TEATRO|PARQUE|BOWLING|PRESENTE\w*|LIVRO)\b/],
    ['Viagens', /\b(LATAM|GOL LINHAS|AZUL LINHAS|HOTEL|POUSADA|RESORT|AIRBNB|BOOKING|DECOLAR|123MILHAS)\b/],
    ['Investimentos', /\b(CDB|APLICACAO|TESOURO|LCI|LCA)\b/]
  ];

  /** Categorias do próprio banco (coluna "Categoria" da fatura do C6). */
  const CATEGORIAS_BANCO = [
    [/SUPERMERCADO/, 'Supermercado/Feira'], [/RESTAURANTE|LANCHONETE|BAR|ALIMENTA/, 'Alimentação fora'],
    [/POSTO|COMBUST/, 'Combustível'], [/TRANSPORTE|ESTACIONAMENTO|PEDAGIO/, 'Transporte'],
    [/DROGARIA|FARMACIA|HOSPITAL|CLINICA|LABORATORIO|SAUDE|MEDIC/, 'Saúde'], [/EDUCACAO|ESCOLA/, 'Educação e filhos'],
    [/HOTEL|TURISMO|VIAGE|AEREA|COMPANHIA/, 'Viagens'], [/ENTRETENIMENTO|LAZER|CINEMA/, 'Lazer e presentes'],
    [/TELECOM|ASSINATURA|STREAMING/, 'Assinaturas'], [/VESTUARIO|DEPARTAMENTO|ELETRO|MOVEIS|CONSTRUCAO|MATERIAL/, 'Casa e compras'],
    [/BELEZA|COSMETICO|ESTETICA/, 'Cuidados pessoais']
  ];

  /** Palavras com # na descrição (ex.: mensagem do Pix "Diarista #moradia"). */
  const APELIDOS = {
    MERCADO: 'Supermercado/Feira', SUPERMERCADO: 'Supermercado/Feira', FEIRA: 'Supermercado/Feira',
    RESTAURANTE: 'Alimentação fora', COMIDA: 'Alimentação fora', ALIMENTACAO: 'Alimentação fora', LANCHE: 'Alimentação fora',
    TRANSPORTE: 'Transporte', UBER: 'Transporte', COMBUSTIVEL: 'Combustível', GASOLINA: 'Combustível',
    CASA: 'Moradia', MORADIA: 'Moradia', ALUGUEL: 'Moradia', SAUDE: 'Saúde', FARMACIA: 'Saúde',
    FILHOS: 'Educação e filhos', ESCOLA: 'Educação e filhos', EDUCACAO: 'Educação e filhos', BENTO: 'Educação e filhos', TERESA: 'Educação e filhos',
    ASSINATURA: 'Assinaturas', ASSINATURAS: 'Assinaturas', LAZER: 'Lazer e presentes', PRESENTE: 'Lazer e presentes',
    CUIDADOS: 'Cuidados pessoais', BELEZA: 'Cuidados pessoais', COMPRAS: 'Casa e compras', CASAECOMPRAS: 'Casa e compras',
    VIAGEM: 'Viagens', VIAGENS: 'Viagens', OUTROS: 'Outros', INVESTIMENTO: 'Investimentos', MARACA: 'Empréstimo Maracá'
  };
  const TIPOS_TAG = { RECEITA: 'Receita', REEMBOLSO: 'Reembolso', APORTE: 'Aporte', DESPESA: 'Despesa' };

  function pelaTag(desc, categorias) {
    const tags = (semAcento(desc).match(/#[A-Za-z0-9]+/g) || []).map(t => t.slice(1).toUpperCase());
    const r = {};
    tags.forEach(t => {
      if (TIPOS_TAG[t]) { r.tipo = TIPOS_TAG[t]; return; }
      if (t === 'CAIO') { r.quem = 'Caio'; return; }
      if (t === 'ISABELA' || t === 'BELA') { r.quem = 'Isabela'; return; }
      const direta = categorias.find(c => norm(c).replace(/ /g, '').indexOf(t) === 0);
      const cat = APELIDOS[t] || direta;
      if (cat && categorias.indexOf(cat) >= 0) r.categoria = cat;
    });
    return r;
  }

  /* ---------------- Classificação ---------------- */
  /**
   * Transforma os itens lidos em lançamentos prontos, com categoria, tipo, quem e
   * um motivo quando houver dúvida.
   * opts: { conta, fechamento (ISO, para parcelas), historico, listas }
   */
  function classificar(itens, opts) {
    const L = opts.listas;
    const ap = aprender(opts.historico || []);
    const out = [];
    itens.forEach(it => {
      const r = { data: it.data, valor: it.valor, descricao: it.descricao, conta: opts.conta, categoria: 'Outros', quem: 'Conjunto', tipo: 'Despesa', parcelas: '', obs: [], duvida: '', ignorar: '', origem: it.origem };
      const D = norm(it.descricao);
      const notas = r.obs;

      if (it.origem === 'fatura') {
        if (it.final) {
          r.quem = ap.quemPorFinal[it.final] || r.quem;
          if (!ap.quemPorFinal[it.final]) r.duvida = 'Cartão final ' + it.final + ' ainda sem dono conhecido';
        }
        if (it.valorBruto < 0) {
          if (/PAGAMENTO|PGTO|INCLUSAO DE PAG|PAG FATURA|PAGTO/.test(D)) { r.ignorar = 'Pagamento da fatura (não conta como despesa)'; }
          else r.tipo = 'Reembolso';
        }
        const p = (it.parcela || '').match(/(\d+)\s*\/\s*(\d+)/);
        if (p && +p[2] > 1) {
          r.parcelas = p[2];
          notas.push('Parcela ' + (+p[1]) + '/' + (+p[2]) + ' de compra de ' + isoParaBR(it.data));
          if (opts.fechamento) r.data = opts.fechamento;
        }
        if (it.usd) notas.push('USD ' + it.usd.toFixed(2).replace('.', ',') + (it.cotacao ? ' (cotação ' + it.cotacao.toFixed(2).replace('.', ',') + ')' : ''));
        if (it.final) notas.push('Cartão final ' + it.final);
      } else {
        // extrato da conta conjunta
        if (/FATURA|PGTO CART|PAGAMENTO CART|PAG CART/.test(D)) r.ignorar = 'Pagamento de fatura (as compras entram pela fatura)';
        else if (/RESGATE|RENDIMENTO|IRRF/.test(D)) r.ignorar = 'Movimento de investimento (rotação, não é receita)';
        if (it.valorBruto > 0 && !r.ignorar) {
          if (/ISABELA|ASSIS BRITO/.test(D)) { r.tipo = 'Receita'; r.quem = 'Isabela'; r.descricao = 'Aporte de Isabela (outra conta)'; r.fixo = true; notas.push('Transferência da conta pessoal para a conta conjunta'); r.categoria = 'Outros'; }
          else if (/CAIO|SALOMAO/.test(D)) { r.tipo = 'Receita'; r.quem = 'Caio'; r.descricao = 'Aporte de Caio (outra conta)'; r.fixo = true; notas.push('Transferência da conta pessoal para a conta conjunta'); r.categoria = 'Outros'; }
          else { r.tipo = 'Reembolso'; r.duvida = 'Dinheiro que entrou: é reembolso de alguém ou receita?'; }
        }
        notas.push('Conta C6 (extrato)');
      }

      if (!r.ignorar && !r.fixo) {
        let achou = '', certeza = false;
        const tag = pelaTag(it.descricao, L.categorias);
        if (tag.tipo) r.tipo = tag.tipo;
        if (tag.quem) r.quem = tag.quem;
        if (tag.categoria) { r.categoria = tag.categoria; achou = 'tag'; certeza = true; }
        if (!achou) {
          const k = chaves(it.descricao);
          for (const n of ['k1', 'k2', 'k3']) {
            const m = k[n] && ap.mapas[n][k[n]];
            if (!m) continue;
            const cat = ap.topo(m.cat), parte = m.cat[cat] / m.total;
            r.categoria = cat; achou = n;
            certeza = (n === 'k1' && parte >= 0.75) || (n === 'k2' && parte >= 0.8 && m.total >= 2) || (n === 'k3' && parte >= 0.9 && m.total >= 3);
            const tipoAprendido = ap.topo(m.tipo);
            if (it.origem === 'extrato' && it.valorBruto < 0 && (tipoAprendido === 'Aporte')) r.tipo = 'Aporte';
            if (it.origem === 'extrato' && it.valorBruto < 0 && ap.topo(m.quem) && !tag.quem) r.quem = ap.topo(m.quem);
            break;
          }
        }
        if (!achou) {
          const regra = REGRAS.find(([, re]) => re.test(D));
          if (regra && L.categorias.indexOf(regra[0]) >= 0) { r.categoria = regra[0]; achou = 'regra'; certeza = true; }
        }
        if (!achou && it.categoriaBanco) {
          const cb = norm(it.categoriaBanco);
          const m = CATEGORIAS_BANCO.find(([re]) => re.test(cb));
          if (m && L.categorias.indexOf(m[1]) >= 0) { r.categoria = m[1]; achou = 'banco'; certeza = true; }
        }
        if (r.categoria === 'Investimentos' && r.tipo === 'Despesa') r.tipo = 'Aporte';
        if (r.categoria === 'Empréstimo Maracá' && r.tipo === 'Despesa') r.tipo = 'Aporte';
        if (!achou) r.duvida = r.duvida || 'Não reconheci esta descrição';
        else if (!certeza) r.duvida = r.duvida || 'Sugestão a confirmar (já vi parecido com outras categorias)';
        if (/^(TRANSF ENVIADA PIX|PIX ENVIADO|TRANSFERENCIA ENVIADA|BOLETO|PIX RECORRENTE)$/.test(D) || D === '') r.duvida = 'Pix ou boleto sem descrição: diga o que foi';
      }
      if (r.tipo === 'Reembolso' && it.origem === 'fatura' && !r.duvida) r.duvida = 'Estorno no cartão: confira a categoria';
      r.obs = notas.join('; ');
      out.push(r);
    });
    return out;
  }

  /* ---------------- Duplicados ---------------- */
  /** Marca itens já lançados. Cada lançamento existente só "cobre" um item novo. */
  function marcarDuplicados(novos, historico) {
    const usados = new Set();
    const porValor = {};
    historico.forEach((h, i) => { const k = centavos(h.valor); (porValor[k] = porValor[k] || []).push(i); });
    const parecido = (a, b) => {
      const A = chaves(a), B = chaves(b);
      return A.k1 === B.k1 || (A.k2 && A.k2 === B.k2) || (A.k3 && A.k3 === B.k3) || norm(a).indexOf(norm(b)) >= 0 || norm(b).indexOf(norm(a)) >= 0;
    };
    // 1ª passada: mesma conta, mesmo valor, data igual (ou ±3 dias para parcelas) e descrição parecida
    novos.forEach(n => {
      if (n.ignorar) return;
      const cands = (porValor[centavos(n.valor)] || []).filter(i => !usados.has(i));
      const tol = n.parcelas ? 3 : (n.origem === 'extrato' ? 1 : 0);
      const i = cands.find(i => {
        const h = historico[i];
        if (n.parcelas) { const pn = (n.obs.match(/Parcela \d+\/\d+/) || [''])[0]; if (pn && (h.obs || '').indexOf(pn) < 0) return false; }
        return h.conta === n.conta && Math.abs(diasEntre(h.data, n.data)) <= tol && (parecido(h.descricao, n.descricao) || h.tipo === n.tipo && /Aporte de|Pix recebido/.test(h.descricao + n.descricao));
      });
      if (i !== undefined) { usados.add(i); n.duplicado = historico[i]; }
    });
    // 2ª passada: mesmo valor e data próxima, mas descrição diferente (ex.: lançado à mão no site)
    novos.forEach(n => {
      if (n.ignorar || n.duplicado) return;
      const cands = (porValor[centavos(n.valor)] || []).filter(i => !usados.has(i));
      const i = cands.find(i => {
        const h = historico[i];
        if (n.parcelas && /Parcela/.test(h.obs || '')) return false;
        const manual = !/Cart[aã]o final|\(extrato\)/i.test(h.obs || '');
        return Math.abs(diasEntre(h.data, n.data)) <= (manual ? 4 : 0) && (manual || h.conta === n.conta);
      });
      if (i !== undefined) { usados.add(i); n.talvezDuplicado = historico[i]; }
    });
    return novos;
  }

  /** Sugere a data de fechamento: o dia da compra à vista mais recente da fatura. */
  function sugerirFechamento(itens) {
    const datas = itens.filter(i => !i.parcela || !/\d+\s*\/\s*([2-9]|\d{2})/.test(i.parcela)).map(i => i.data).sort();
    return datas[datas.length - 1] || '';
  }

  const API = { lerOFX, lerCSV, lerTabela, lerTextoFatura, classificar, marcarDuplicados, sugerirFechamento, decodificar, numeroBR, dataISO, chaves, aprender, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.ImportarMotor = API;
})(this);
