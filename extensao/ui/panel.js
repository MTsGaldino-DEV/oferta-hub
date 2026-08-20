/**
 * Painel lateral: le a aba ativa do Mercado Livre, mostra os produtos
 * encontrados com checkbox e manda os selecionados para o Hub. Substitui o
 * popup minusculo de antes -- fica aberto junto da pagina, acompanha a troca
 * de aba e a navegacao dentro do site (SPA), e nao fecha a cada clique.
 */

// ---------------------------------------------------------------------------
// elementos
// ---------------------------------------------------------------------------

const $ligacao = document.getElementById('ligacao');
const $foraDoMl = document.getElementById('fora-do-ml');
const $semContentScript = document.getElementById('sem-content-script');
const $areaCaptura = document.getElementById('area-captura');
const $origemAtual = document.getElementById('origem-atual');
const $atualizar = document.getElementById('atualizar');
const $lista = document.getElementById('lista');
const $marcarTodos = document.getElementById('marcar-todos');
const $contagem = document.getElementById('contagem');
const $enviar = document.getElementById('enviar');
const $resultado = document.getElementById('resultado');

const $api = document.getElementById('api');
const $token = document.getElementById('token');
const $salvar = document.getElementById('salvar');
const $estadoConfig = document.getElementById('estado-config');

// ---------------------------------------------------------------------------
// formatacao
// ---------------------------------------------------------------------------

const brl = (v) =>
  typeof v === 'number'
    ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null;

/** "1.234 vendidos" ou "+12 mil vendidos" -- mesmo corte usado na fila do app. */
function vendidos(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 1000) return `${n} vendidos`;
  return `+${Math.floor(n / 1000)} mil vendidos`;
}

// ---------------------------------------------------------------------------
// estado da aba: qual pagina, quais produtos
// ---------------------------------------------------------------------------

let abaId = null;
/** [{ produto, selecionado }] -- o que a pagina atual ofereceu para captura. */
let itens = [];

const ehPaginaMl = (url) => /(^|\/\/)([^/]*\.)?mercadoli(vre|bre)\.com(\.br)?\//i.test(url || '');

async function abaAtiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function mostrarSecao(id) {
  for (const el of [$foraDoMl, $semContentScript, $areaCaptura]) {
    el.hidden = el.id !== id;
  }
}

async function escanear() {
  $resultado.textContent = '';
  const tab = await abaAtiva();
  if (!tab?.id || !ehPaginaMl(tab.url)) {
    abaId = null;
    itens = [];
    mostrarSecao('fora-do-ml');
    return;
  }
  abaId = tab.id;

  let resposta;
  try {
    resposta = await chrome.tabs.sendMessage(tab.id, { tipo: 'raspar' });
  } catch {
    mostrarSecao('sem-content-script');
    return;
  }

  itens = (resposta?.produtos || []).map((produto) => ({ produto, selecionado: true }));
  mostrarSecao('area-captura');
  $origemAtual.textContent = itens[0]?.produto.origem === 'produto' ? 'Página do produto' : 'Busca';
  renderizar();
}

// ---------------------------------------------------------------------------
// lista
// ---------------------------------------------------------------------------

function renderizar() {
  $lista.innerHTML = '';

  if (!itens.length) {
    const vazio = document.createElement('p');
    vazio.className = 'aviso-vazio';
    vazio.style.margin = '10px 4px';
    vazio.textContent = 'Não encontrei produto nesta página.';
    $lista.appendChild(vazio);
  }

  for (const [i, item] of itens.entries()) {
    const { produto } = item;
    const linha = document.createElement('label');
    linha.className = 'item';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = item.selecionado;
    check.addEventListener('change', () => {
      item.selecionado = check.checked;
      atualizarRodape();
    });

    const corpo = document.createElement('div');
    corpo.className = 'item__corpo';

    const titulo = document.createElement('span');
    titulo.className = 'item__titulo';
    titulo.title = produto.title;
    titulo.textContent = produto.title;

    const linhaPreco = document.createElement('div');
    linhaPreco.className = 'item__linha';
    const precoTxt = brl(produto.price);
    const deTxt = brl(produto.listPrice);
    if (precoTxt) {
      const preco = document.createElement('span');
      preco.className = 'item__preco';
      preco.textContent = precoTxt;
      linhaPreco.appendChild(preco);
    }
    if (deTxt) {
      const de = document.createElement('span');
      de.className = 'item__de';
      de.textContent = deTxt;
      linhaPreco.appendChild(de);
    }
    const vTxt = vendidos(produto.soldCount);
    if (vTxt) {
      const v = document.createElement('span');
      v.className = 'item__vendidos';
      v.textContent = vTxt;
      linhaPreco.appendChild(v);
    }

    corpo.append(titulo, linhaPreco);
    linha.append(check, corpo);
    $lista.appendChild(linha);
    void i;
  }

  atualizarRodape();
}

function atualizarRodape() {
  const selecionados = itens.filter((i) => i.selecionado).length;
  $contagem.textContent = `${selecionados} selecionado${selecionados === 1 ? '' : 's'}`;
  $marcarTodos.checked = itens.length > 0 && selecionados === itens.length;
  $enviar.disabled = selecionados === 0;
}

$marcarTodos.addEventListener('change', () => {
  for (const item of itens) item.selecionado = $marcarTodos.checked;
  for (const check of $lista.querySelectorAll('input[type="checkbox"]')) {
    check.checked = $marcarTodos.checked;
  }
  atualizarRodape();
});

$atualizar.addEventListener('click', () => {
  $atualizar.disabled = true;
  escanear().finally(() => {
    $atualizar.disabled = false;
  });
});

$enviar.addEventListener('click', async () => {
  const selecionados = itens.filter((i) => i.selecionado).map((i) => i.produto);
  if (!selecionados.length || !abaId) return;

  $enviar.disabled = true;
  $resultado.textContent = 'Enviando...';
  $resultado.removeAttribute('data-tom');

  try {
    const r = await chrome.runtime.sendMessage({ tipo: 'capturar', produtos: selecionados, tabId: abaId });
    if (!r?.ok) throw new Error(r?.error || 'falhou');

    const partes = [`${r.criados} na fila`];
    if (r.repetidos) partes.push(`${r.repetidos} já estavam`);
    if (r.semLink) partes.push(`${r.semLink} sem link de afiliado`);
    if (r.avisoLink) console.warn('[Hub Ofertas] link de afiliado:', r.avisoLink);

    $resultado.textContent = partes.join(', ') + '.';
    $resultado.dataset.tom = r.semLink ? 'erro' : 'ok';

    // Manda de novo o mesmo produto seria so duplicar -- some da lista o que
    // acabou de sair, fica so o que falhou para tentar de novo.
    const falharam = new Set((r.falhas || []).map((f) => f.split(':')[0]));
    itens = itens.filter((i) => falharam.has(i.produto.externalId));
    renderizar();
  } catch (e) {
    $resultado.textContent = e.message;
    $resultado.dataset.tom = 'erro';
  } finally {
    atualizarRodape();
  }
});

// ---------------------------------------------------------------------------
// acompanha troca de aba e navegacao (SPA do ML nao recarrega a pagina)
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(() => void escanear());
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (tab.active && info.status === 'complete') void escanear();
});

// ---------------------------------------------------------------------------
// conexao com o Hub
// ---------------------------------------------------------------------------

async function testarLigacao() {
  const r = await chrome.runtime.sendMessage({ tipo: 'ping' });
  $ligacao.textContent = r?.ok ? 'Conectado' : 'Desconectado';
  $ligacao.dataset.tom = r?.ok ? 'ok' : 'erro';
  return r;
}

chrome.storage.sync.get({ apiUrl: 'http://localhost:3333', token: '' }).then((c) => {
  $api.value = c.apiUrl;
  $token.value = c.token;
  void testarLigacao();
});

$salvar.addEventListener('click', async () => {
  $salvar.disabled = true;
  $estadoConfig.textContent = 'Testando...';
  $estadoConfig.removeAttribute('data-tom');
  await chrome.storage.sync.set({ apiUrl: $api.value.trim(), token: $token.value.trim() });
  const r = await testarLigacao();
  $estadoConfig.textContent = r?.ok ? 'Conectado ao Hub Ofertas.' : r?.error || 'Não consegui falar com o app.';
  $estadoConfig.dataset.tom = r?.ok ? 'ok' : 'erro';
  $salvar.disabled = false;
});

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

void escanear();
