#!/usr/bin/env node
/**
 * =====================================================================
 * Gera o refresh token do Mercado Livre.
 * ---------------------------------------------------------------------
 * Roda 100% na sua máquina. O Client Secret nunca sai daqui, nunca vai
 * pra nenhum servidor além do próprio Mercado Livre.
 *
 * Por que não sobe um servidor local sozinho: o painel do Mercado Livre
 * exige que a "URI de redirect" comece com https://, e não aceita
 * http://localhost. Em vez de montar certificado HTTPS local só pra
 * isso, o fluxo aqui é manual: você loga, o Mercado Livre te manda pra
 * uma página real com o código na barra de endereço, e você cola essa
 * URL de volta aqui. Dois copia-e-colas, sem servidor, sem certificado.
 *
 * COMO USAR
 *   1. No painel do seu app (developers.mercadolivre.com.br), na aba de
 *      configuração da aplicação, em "URIs de redirect", cadastre
 *      exatamente:
 *          https://example.com/
 *      (tem que bater igualzinho com o que o script usa abaixo — se
 *      quiser trocar por outra URL https seguindo, ajuste também a
 *      constante REDIRECT_URI logo adiante)
 *
 *   2. Confirme que o fluxo "Authorization Code" está habilitado na
 *      seção "Fluxos OAuth" dessa mesma tela.
 *
 *   3. Nas permissões, não precisa mexer em nada além do padrão:
 *      "Usuários" já vem liberado, o resto pode ficar em "Sem acesso".
 *
 *   4. Rode:
 *          ML_CLIENT_ID=seu_id ML_CLIENT_SECRET=seu_secret node scripts/mercadolivre-oauth.mjs
 *
 *      Ou crie um arquivo .env.ml na raiz do projeto (já está no
 *      .gitignore, nunca é versionado):
 *          ML_CLIENT_ID=seu_id
 *          ML_CLIENT_SECRET=seu_secret
 *      e rode só: node scripts/mercadolivre-oauth.mjs
 *
 *   5. O script imprime uma URL e tenta abrir o navegador sozinho.
 *      Faça login na conta que vai ser a afiliada e clique em autorizar.
 *
 *   6. O Mercado Livre redireciona pra https://example.com/?code=...
 *      A página vai parecer "vazia" ou genérica — é esperado, ela não
 *      faz nada com o código. O que importa é a URL na barra de
 *      endereço do navegador.
 *
 *   7. Copie essa URL inteira e cole no terminal quando o script pedir.
 *
 *   8. Ele troca o código por token e imprime os três valores prontos
 *      pra colar no dashboard, em Conexões > Mercado Livre.
 * =====================================================================
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carrega .env.ml manualmente, sem depender de pacote nenhum.
const envFile = path.join(__dirname, '..', '.env.ml');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([\w.]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const CLIENT_ID = process.env.ML_CLIENT_ID;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
// Precisa ser https:// e bater exatamente com o que está cadastrado no painel.
const REDIRECT_URI = process.env.ML_REDIRECT_URI ?? 'https://example.com/';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    '\nFaltou ML_CLIENT_ID e/ou ML_CLIENT_SECRET.\n' +
      'Rode assim: ML_CLIENT_ID=xxx ML_CLIENT_SECRET=yyy node scripts/mercadolivre-oauth.mjs\n' +
      'ou crie o arquivo .env.ml na raiz do projeto (veja o topo deste arquivo).\n',
  );
  process.exit(1);
}

if (!REDIRECT_URI.startsWith('https://')) {
  console.error('\nML_REDIRECT_URI precisa começar com https:// — o Mercado Livre recusa http.\n');
  process.exit(1);
}

// PKCE: prova que quem troca o código é o mesmo que pediu a autorização.
// A tela do app tem um toggle "PKCE necessário" — mandando isso sempre,
// funciona ligado ou desligado.
function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const codeVerifier = base64url(crypto.randomBytes(48));
const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
const state = base64url(crypto.randomBytes(16));

const authUrl = new URL('https://auth.mercadolivre.com.br/authorization');
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('code_challenge', codeChallenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('state', state);

console.log('\n1. Abrindo o navegador. Se não abrir sozinho, cole esta URL:\n');
console.log(authUrl.toString());
console.log('\n2. Faça login na conta que vai ser a afiliada e clique em autorizar.');
console.log(`3. Você vai cair em ${REDIRECT_URI}?code=...&state=... — copie a URL inteira da barra de endereço.\n`);

{
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const { exec } = await import('node:child_process');
  exec(`${opener} "${authUrl.toString()}"`, () => {});
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pasted = (await rl.question('Cole aqui a URL para onde você foi redirecionado: ')).trim();
rl.close();

// Aceita tanto a URL inteira quanto só o código, caso a pessoa já copie a parte certa.
let code;
let returnedState;
try {
  const parsed = new URL(pasted);
  code = parsed.searchParams.get('code');
  returnedState = parsed.searchParams.get('state');
} catch {
  code = pasted; // não era uma URL válida — assume que é o código puro
}

if (!code) {
  console.error('\nNão encontrei "code=" no que foi colado. Copie a URL completa, com o ?code=... no final.\n');
  process.exit(1);
}

if (returnedState && returnedState !== state) {
  console.error('\nO parâmetro state não bateu com o que foi enviado. Por segurança, rode o script de novo.\n');
  process.exit(1);
}

try {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const data = await tokenRes.json();

  if (!tokenRes.ok) {
    throw new Error(data.message ?? JSON.stringify(data));
  }

  console.log('\n✔ Autorizado como user_id:', data.user_id);
  console.log('\nCole isto no dashboard, em Conexões > Mercado Livre:\n');
  console.log('Client ID:      ', CLIENT_ID);
  console.log('Client Secret:  ', CLIENT_SECRET);
  console.log('Refresh Token:  ', data.refresh_token);
  console.log('\n(o access token expira em 6h e é renovado sozinho pelo sistema — não precisa guardar)\n');
} catch (err) {
  console.error('\nFalhou ao trocar o código por token:', err.message, '\n');
  console.error('Causas comuns: o código já expirou (eles valem só alguns minutos, rode tudo de novo sem demorar),');
  console.error('ou o redirect_uri usado aqui não bate exatamente com o cadastrado no painel.\n');
  process.exit(1);
}
