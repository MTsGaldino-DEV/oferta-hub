/**
 * Painel lateral: le a aba ativa do Mercado Livre, mostra os produtos
 * encontrados com checkbox e manda os selecionados para o Hub. Substitui o
 * popup minusculo de antes -- fica aberto junto da pagina, acompanha a troca
 * de aba e a navegacao dentro do site (SPA), e nao fecha a cada clique.
 */

import { registrarLog, lerLogs, limparLogs } from '../lib/log.js';

// ---------------------------------------------------------------------------
// elementos
// ---------------------------------------------------------------------------

const $abaBtnCaptura = document.getElementById('aba-btn-captura');
const $abaBtnLogs = document.getElementById('aba-btn-logs');
const $abaCaptura = document.getElementById('aba-captura');
const $abaLogs = document.getElementById('aba-logs');
const $logsContagemAba = document.getElementById('logs-contagem-aba');
const $logsContagem = document.getElementById('logs-contagem');
const $logsLista = document.getElementById('logs-lista');
const $logsLimpar = document.getElementById('logs-limpar');

const $ligacao = document.getElementById('ligacao');
const $foraDoMl = document.getElementById('fora-do-ml');
const $semContentScript = document.getElementById('sem-content-script');
const $areaCaptura = document.getElementById('area-captura');
const $origemAtual = document.getElementById('origem-atual');
const $atualizar = document.getElementById('atualizar');
const $limpar = document.getElementById('limpar');
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

/**
 * Os botoes do hub (pagina do ML) so capturam e guardam aqui -- nunca mandam
 * pro Hub sozinhos. E aqui, na revisao com checkbox, que o envio de verdade
 * acontece (botao "Enviar ao Hub"). Roda no load do painel e sempre que o
 * storage muda, pra pegar captura feita com o painel fechado.
 */
async function carregarCapturaPendente({ trocarAba = true } = {}) {
  const { captura_pendente: pendente } = await chrome.storage.local.get('captura_pendente');
  if (!pendente?.produtos?.length) return false;

  const tab = await abaAtiva();
  if (tab?.id) abaId = tab.id;

  itens = pendente.produtos.map((produto) => ({ produto, selecionado: true }));
  mostrarSecao('area-captura');
  $origemAtual.textContent = 'Painel de afiliado';
  renderizar();
  await chrome.storage.local.remove('captura_pendente');
  void registrarLog('painel', 'info', `Carreguei ${itens.length} produto(s) capturados da página para revisão.`);
  if (trocarAba) mostrarAba('captura');
  return true;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.captura_pendente?.newValue) void carregarCapturaPendente();
});

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

$limpar.addEventListener('click', () => {
  itens = [];
  $resultado.textContent = '';
  $resultado.removeAttribute('data-tom');
  renderizar();
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
    void registrarLog('painel', 'info', `Enviei ${selecionados.length} produto(s): ${partes.join(', ')}.`);

    // Manda de novo o mesmo produto seria so duplicar -- some da lista o que
    // acabou de sair, fica so o que falhou para tentar de novo.
    const falharam = new Set((r.falhas || []).map((f) => f.split(':')[0]));
    itens = itens.filter((i) => falharam.has(i.produto.externalId));
    renderizar();
  } catch (e) {
    $resultado.textContent = e.message;
    $resultado.dataset.tom = 'erro';
    void registrarLog('painel', 'erro', `Falha ao enviar: ${e.message}`);
  } finally {
    atualizarRodape();
  }
});

// ---------------------------------------------------------------------------
// aba de logs
// ---------------------------------------------------------------------------

function mostrarAba(nome) {
  const logs = nome === 'logs';
  $abaCaptura.hidden = logs;
  $abaLogs.hidden = !logs;
  $abaBtnCaptura.classList.toggle('aba--ativa', !logs);
  $abaBtnLogs.classList.toggle('aba--ativa', logs);
  if (logs) void renderizarLogs();
}

const doisDigitos = (n) => String(n).padStart(2, '0');
const formatarHora = (ts) => {
  const d = new Date(ts);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}:${doisDigitos(d.getSeconds())}`;
};

async function renderizarLogs() {
  const logs = await lerLogs();
  $logsContagemAba.textContent = logs.length || '';
  $logsContagem.textContent = `${logs.length} registro${logs.length === 1 ? '' : 's'}`;
  $logsLista.innerHTML = '';

  if (!logs.length) {
    const vazio = document.createElement('p');
    vazio.className = 'aviso-vazio';
    vazio.style.margin = '10px 4px';
    vazio.textContent = 'Nada por aqui ainda.';
    $logsLista.appendChild(vazio);
    return;
  }

  // Mais recente primeiro -- e o que interessa quando algo acabou de dar errado.
  for (const log of [...logs].reverse()) {
    const linha = document.createElement('div');
    linha.className = 'log-item';
    linha.dataset.nivel = log.nivel;

    const hora = document.createElement('span');
    hora.className = 'log-item__hora';
    hora.textContent = formatarHora(log.ts);

    const origem = document.createElement('span');
    origem.className = 'log-item__origem';
    origem.textContent = log.origem;

    const texto = document.createElement('span');
    texto.className = 'log-item__texto';
    texto.textContent = log.texto;

    linha.append(hora, origem, texto);
    $logsLista.appendChild(linha);
  }
}

$abaBtnCaptura.addEventListener('click', () => mostrarAba('captura'));
$abaBtnLogs.addEventListener('click', () => mostrarAba('logs'));

$logsLimpar.addEventListener('click', async () => {
  await limparLogs();
  void renderizarLogs();
});

// Atualiza a contagem na aba (e a lista, se estiver aberta) assim que
// pagina ou service worker registram algo novo -- sem precisar reabrir o painel.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.logs) return;
  const n = changes.logs.newValue?.length || 0;
  $logsContagemAba.textContent = n || '';
  if (!$abaLogs.hidden) void renderizarLogs();
});

void renderizarLogs();

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

carregarCapturaPendente({ trocarAba: false }).then((carregou) => {
  if (!carregou) void escanear();
});
