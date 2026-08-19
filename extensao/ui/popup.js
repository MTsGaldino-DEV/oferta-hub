const api = document.getElementById('api');
const token = document.getElementById('token');
const estado = document.getElementById('estado');
const salvar = document.getElementById('salvar');

const mostrar = (texto, tom) => {
  estado.textContent = texto;
  estado.dataset.tom = tom;
};

chrome.storage.sync.get({ apiUrl: 'http://localhost:3333', token: '' }).then((c) => {
  api.value = c.apiUrl;
  token.value = c.token;
  if (c.token) void testar();
});

async function testar() {
  const r = await chrome.runtime.sendMessage({ tipo: 'ping' });
  if (r?.ok) mostrar('Conectado ao Hub Ofertas.', 'ok');
  else mostrar(r?.error || 'Não consegui falar com o app.', 'erro');
}

salvar.addEventListener('click', async () => {
  salvar.disabled = true;
  mostrar('Testando...', '');
  await chrome.storage.sync.set({ apiUrl: api.value.trim(), token: token.value.trim() });
  await testar();
  salvar.disabled = false;
});
