import fs from 'node:fs/promises';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  prepareWAMessageMedia,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type GroupMetadata,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { createMutex } from '../lib/mutex.js';
import { avaliarEntrada } from '../services/moderacao.js';

/**
 * Baileys entrega o jid da propria conta com sufixo de dispositivo
 * (numero:12@dominio); participantes de grupo (meta.participants) chegam sem
 * ele. Sem cortar, a comparacao nunca bate -- usado tanto pro botIsAdmin do
 * sync quanto pela moderacao pra reconhecer a propria conta.
 *
 * Baixa a caixa tambem (o sufixo do servidor pode variar) e nao quebra se a
 * entrada nao tiver "@" -- devolve ela lowercased em vez de produzir
 * "x@undefined".
 */
export function semSufixoDispositivo(jid: string): string {
  const [usuario, dominio] = jid.toLowerCase().split('@');
  if (!dominio) return jid.toLowerCase();
  return `${usuario.split(':')[0]}@${dominio}`;
}

/**
 * Um participante pode aparecer em ate tres formas (`id`, `jid`, `lid` --
 * ver lib/Socket/groups.js: `id: attrs.jid, jid: ..., lid: ...`), e a propria
 * conta tambem tem duas identidades possiveis (`sock.user.id` e
 * `sock.user.lid`, ver lib/Socket/socket.js:504). Comparar so `p.id === eu`
 * falha sempre que o grupo usa endereçamento LID e `eu` foi lido no formato
 * jid (ou vice-versa) -- o mesmo participante nunca bate porque as strings
 * sao de espacos diferentes.
 *
 * Exportada: a moderacao usa a mesma coisa pra montar o Set de admins do
 * grupo (mesmo defeito, mesma correcao).
 */
export function formasDoParticipante(p: { id: string; jid?: string; lid?: string }): string[] {
  return [p.id, p.jid, p.lid].filter((v): v is string => !!v);
}

/** `meusIds` junta as duas identidades proprias (id e lid, sem sufixo de
 * dispositivo); `ehParticipanteProprio` testa as formas do participante
 * contra elas. */
function meusIds(sock: WASocket): Set<string> {
  return new Set(
    [sock.user?.id, sock.user?.lid].filter((v): v is string => !!v).map(semSufixoDispositivo),
  );
}

function ehParticipanteProprio(p: { id: string; jid?: string; lid?: string }, ids: Set<string>): boolean {
  return formasDoParticipante(p).some((v) => ids.has(v));
}

/**
 * Sobe a foto do produto pros servidores do WhatsApp e devolve os campos de
 * "high quality thumbnail" que fazem o card de preview aparecer GRANDE (foto
 * no topo, como o card de referencia) em vez do icone pequeno e quadrado.
 *
 * Existe porque o mecanismo automatico do Baileys (`generateHighQualityLinkPreview`)
 * nao funciona com link de afiliado: o `handleRedirects` dele SO segue redirect
 * pro MESMO hostname (ou www. do mesmo) -- e todo link de afiliado redireciona
 * pra um dominio diferente (meli.la -> mercadolivre.com.br, s.shopee.com.br ->
 * shopee.com.br). Confirmado direto no codigo do pacote instalado. A pagina do
 * Shopee no fim da cadeia nem tem tag og:image (e um shell client-side) -- so
 * ML tem, e mesmo assim o redirect nunca era seguido. Por isso o card saia em
 * branco nas duas plataformas.
 *
 * A saida: montar o preview a mao, com a foto que a gente ja tem salva -- pelo
 * MESMO caminho que o Baileys usa quando a geracao automatica funciona
 * (`prepareWAMessageMedia` com `mediaTypeOverride: 'thumbnail-link'`, so que
 * apontando pra URL da nossa foto em vez da que ele tentaria (e falharia) raspar.
 * So passar o `jpegThumbnail` (miniatura embutida, base64) faz o WhatsApp cair
 * no layout compacto -- foi o que aconteceu no grupo real: card pequeno, sem a
 * foto grande. O card grande exige a imagem de verdade hospedada no servidor do
 * WhatsApp (`thumbnailDirectPath`/`mediaKey`), que so existe depois desse upload.
 */
async function gerarPreviewImagem(sock: WASocket, url: string): Promise<Record<string, unknown>> {
  try {
    const { imageMessage } = await prepareWAMessageMedia(
      { image: { url } },
      { upload: sock.waUploadToServer, mediaTypeOverride: 'thumbnail-link' },
    );
    if (!imageMessage) return {};
    return {
      jpegThumbnail: imageMessage.jpegThumbnail,
      highQualityThumbnail: imageMessage,
    };
  } catch (err) {
    logger.warn({ url, err: String(err) }, 'nao consegui gerar preview grande do link, seguindo sem foto');
    return {};
  }
}

/**
 * =====================================================================
 * LEIA ANTES DE USAR
 * ---------------------------------------------------------------------
 * O Baileys nao e oficial. Ele fala o protocolo do WhatsApp Web direto,
 * o que viola os Termos de Servico do WhatsApp. O numero pareado aqui
 * PODE SER BANIDO, e o ban costuma ser permanente.
 *
 * Como reduzir (nao zerar) o risco:
 *   - use um chip secundario, nunca o seu numero pessoal;
 *   - deixe o numero "esquentar" por alguns dias com uso normal antes;
 *   - respeite WA_MIN_INTERVAL_SECONDS e WA_DAILY_CAP (padrao 90s / 40 por dia);
 *   - varie o texto: mensagens identicas em sequencia sao o padrao classico de
 *     spam e o que mais gera denuncia;
 *   - o que realmente derruba numero e denuncia de usuario. Grupo com opt-in
 *     e volume moderado aguenta; disparo em massa nao.
 * =====================================================================
 */

type Status = 'disconnected' | 'connecting' | 'qr' | 'connected';

/**
 * Falha rotineira que some sozinha: teto diario ainda nao resetou, ou o
 * numero esta reconectando. Quem chama sendOffer (o worker de Disparos) usa
 * `instanceof` pra distinguir isso de um erro de verdade -- string matching
 * em mensagem de erro quebraria silenciosamente se o texto mudasse.
 */
export class WhatsAppRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppRetryableError';
  }
}

/**
 * `removerDoGrupo` usa isso quando o Baileys devolve a lista de afetados
 * vazia mesmo apos a remocao ser aceita (ver comentario ali). Nao e uma
 * falha de verdade -- quem chama (moderacao.ts) trata via `instanceof`
 * assumindo que a remocao ocorreu, em vez de registrar FAILED pra algo que
 * pode ter dado certo.
 */
export class RemocaoSemConfirmacaoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemocaoSemConfirmacaoError';
  }
}

class WhatsAppService {
  private sock: WASocket | null = null;
  private lastSentAt = 0;
  // Sem isso, um clique manual e o agendador/automacao podem cair no mesmo
  // instante: os dois passam pela checagem de teto/intervalo antes de
  // qualquer um incrementar o contador, e o limite anti-ban estoura.
  private readonly lock = createMutex();
  status: Status = 'disconnected';
  qrDataUrl: string | null = null;
  me: string | null = null;
  // Identidade LID da propria conta -- existe porque grupo com endereçamento
  // LID nunca bate contra `me` (que vem em formato jid). Preenchida junto
  // com `me`; `sock.user.lid` so chega depois do merge do 'creds.update'
  // interno do Baileys (lib/Socket/socket.js:558), que roda antes do nosso
  // handler de 'connection.update' == 'open' (emitido logo em seguida no
  // mesmo fluxo de login, lib/Socket/socket.js:504).
  meLid: string | null = null;

  async connect(): Promise<void> {
    if (this.status === 'connecting' || this.status === 'connected') return;
    this.status = 'connecting';
    this.qrDataUrl = null;

    const { state, saveCreds } = await useMultiFileAuthState(env.wa.stateDir);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      // O dashboard mostra o QR; nao precisamos poluir o terminal.
      printQRInTerminal: false,
      browser: ['Hub Ofertas', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        this.status = 'qr';
        logger.info('QR gerado, leia no dashboard em Conexoes');
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.qrDataUrl = null;
        this.me = this.sock?.user?.id ?? null;
        this.meLid = this.sock?.user?.lid ?? null;
        logger.info({ me: this.me, meLid: this.meLid }, 'WhatsApp conectado');
        await this.syncGroups();
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        this.status = 'disconnected';
        this.sock = null;

        if (loggedOut) {
          // A credencial ja nao vale nada -- guardar ela so trava o app num
          // laco de "desconectado" sem QR. Limpa e deixa pronto pra parear.
          await this.limparSessao();
          logger.error('Sessao encerrada no aparelho. Abra Conexoes e leia o QR pra parear de novo.');
        } else {
          logger.warn({ code }, 'conexao caiu, reconectando em 5s');
          setTimeout(() => void this.connect(), 5000);
        }
      }
    });

    // Entrada/saida de membro em qualquer grupo. So `add`/`remove` sao
    // movimento de membro de verdade -- `promote`/`demote` sao mudanca de
    // admin, nao entram no log (ver doc do model GroupMemberEvent).
    //
    // Handler roda dentro do socket do Baileys: qualquer excecao aqui pode
    // derrubar a conexao usada pra enviar oferta, por isso tudo dentro de
    // try/catch e nada relancado.
    this.sock.ev.on('group-participants.update', async (update) => {
      try {
        const { id: groupJid, participants, action } = update;
        if (action !== 'add' && action !== 'remove') return;

        const delta = action === 'add' ? participants.length : -participants.length;
        await prisma.$transaction([
          prisma.groupMemberEvent.createMany({
            data: participants.map((participant) => ({
              groupJid,
              participant,
              action: action === 'add' ? 'ADD' : 'REMOVE',
            })),
          }),
          // increment/decrement atomico -- sem findUnique + soma na mao, pra
          // nao perder update se um syncGroups() completo rodar junto.
          prisma.whatsappGroup.updateMany({
            where: { jid: groupJid },
            data: { memberCount: { increment: delta } },
          }),
        ]);

        if (action === 'add') {
          // Depois de registrar o evento, nunca antes: moderacao que falha nao
          // pode custar o historico de entrada/saida nem o envio de oferta.
          await avaliarEntrada(groupJid, participants);
        }
      } catch (err) {
        logger.error({ err: String(err) }, 'falha ao registrar entrada/saida de grupo');
      }
    });
  }

  /**
   * Encerra a sessao e apaga as credenciais do disco.
   *
   * Apagar e o ponto: sem isso, uma sessao morta fica para sempre. O Baileys
   * reusa a credencial salva, o servidor recusa, e o app volta a "desconectado"
   * sem nunca gerar QR -- nao ha como parear de novo.
   */
  async logout() {
    await this.sock?.logout().catch(() => undefined);
    this.encerrarSocket();
    await this.limparSessao();
  }

  private encerrarSocket() {
    try {
      this.sock?.end(undefined);
    } catch {
      // socket ja morto; nao ha o que encerrar
    }
    this.sock = null;
    this.status = 'disconnected';
    this.qrDataUrl = null;
    this.me = null;
    this.meLid = null;
  }

  /**
   * Zera a pasta de sessao. O proximo connect() nasce pedindo QR.
   *
   * Apaga o CONTEUDO, nao a pasta: no Docker ela e um bind mount, e remover o
   * ponto de montagem devolve EBUSY -- a limpeza falhava calada e a sessao
   * morta continuava la.
   */
  private async limparSessao() {
    await fs.mkdir(env.wa.stateDir, { recursive: true }).catch(() => undefined);
    let apagados = 0;
    try {
      for (const nome of await fs.readdir(env.wa.stateDir)) {
        await fs.rm(`${env.wa.stateDir}/${nome}`, { recursive: true, force: true });
        apagados++;
      }
    } catch (err) {
      logger.error({ dir: env.wa.stateDir, err: String(err) }, 'nao consegui apagar a sessao');
      throw new Error(`Nao consegui apagar a sessao em ${env.wa.stateDir}: ${String(err)}`);
    }
    logger.info({ dir: env.wa.stateDir, apagados }, 'sessao do WhatsApp apagada');
  }

  /** Guarda os grupos onde o numero esta, pra voce escolher o destino no dashboard. */
  async syncGroups() {
    if (!this.sock) return;
    const groups = await this.sock.groupFetchAllParticipating();
    const ids = meusIds(this.sock);

    // Quanto o Filtro de DDI enxerga na pratica. `p.id` sozinho SUBESTIMA:
    // groups.js preenche `p.jid` com o numero (via phone_number) mesmo
    // quando `p.id` veio em LID -- ver lib/Socket/groups.js:312-318. `p.jid`
    // vazio ('') e o unico sinal confiavel de "sem numero em lugar nenhum".
    // Os tres contam coisas diferentes de proposito: idEhNumero mede so o
    // campo antigo (pra comparar com a medicao anterior, que estava errada);
    // jidPreenchido e a metrica real de visibilidade; semNumero e o
    // complemento dela, o ponto cego de verdade.
    let idEhNumero = 0;
    let jidPreenchido = 0;
    let semNumero = 0;

    for (const [jid, meta] of Object.entries(groups)) {
      const memberCount = meta.participants.length;
      const botIsAdmin = meta.participants.some(
        (p) => ehParticipanteProprio(p, ids) && (p.admin === 'admin' || p.admin === 'superadmin'),
      );
      for (const p of meta.participants) {
        if (p.id.endsWith('@s.whatsapp.net')) idEhNumero++;
        if (p.jid) jidPreenchido++;
        else semNumero++;
      }
      await prisma.whatsappGroup.upsert({
        where: { jid },
        create: { jid, name: meta.subject, memberCount, botIsAdmin },
        update: { name: meta.subject, memberCount, botIsAdmin },
      });
    }
    logger.info({ idEhNumero, jidPreenchido, semNumero }, 'participantes com numero visivel (id vs jid) vs sem numero nenhum');
    logger.info({ count: Object.keys(groups).length }, 'grupos sincronizados');
  }

  /**
   * Remove um participante do grupo. Exige que o numero conectado seja admin.
   *
   * A chamada do Baileys RESOLVE mesmo quando o WhatsApp recusa a remocao
   * (ex: o bot deixou de ser admin) -- o resultado vem no status por
   * participante (lib/Socket/groups.js: `status: p.attrs.error || '200'`),
   * nao por excecao. So um erro de rede/IQ derruba a promise. Sem checar o
   * status aqui, uma remocao recusada seria registrada como sucesso.
   */
  async removerDoGrupo(groupJid: string, participantJid: string): Promise<void> {
    if (!this.sock) throw new Error('WhatsApp desconectado. Conecte em Configurações › Canais.');
    const [resultado] = await this.sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
    if (!resultado) {
      // lib/Socket/groups.js:150-153: `getBinaryNodeChildren(node, 'participant')`
      // pode vir vazia mesmo com a remocao aceita -- resposta sem eco, nao
      // recusa. Erro proprio: quem chama trata isso como "provavelmente
      // saiu", nao como falha (ver RemocaoSemConfirmacaoError).
      throw new RemocaoSemConfirmacaoError('WhatsApp nao confirmou a remocao (resposta sem participante)');
    }
    if (resultado.status !== '200') {
      throw new Error(`WhatsApp recusou a remocao (status ${resultado.status})`);
    }
  }

  /**
   * Metadados atuais do grupo (quem e admin agora), direto do WhatsApp -- a
   * tabela local so guarda agregados (memberCount, botIsAdmin do proprio
   * numero), nao a lista de admins de cada participante. Usado pela
   * moderacao pra decidir quem pode ser removido.
   */
  async groupMetadata(groupJid: string): Promise<GroupMetadata | null> {
    if (!this.sock) return null;
    return this.sock.groupMetadata(groupJid);
  }

  private async checkQuota() {
    const day = new Date().toISOString().slice(0, 10);
    const log = await prisma.sendLog.upsert({
      where: { day },
      create: { day, count: 0 },
      update: {},
    });
    if (log.count >= env.wa.dailyCap) {
      throw new WhatsAppRetryableError(
        `Teto diario de ${env.wa.dailyCap} envios atingido. Isso e proposital: passar disso e o caminho mais rapido pro ban.`,
      );
    }
    return day;
  }

  private async waitInterval() {
    const gap = Date.now() - this.lastSentAt;
    const min = env.wa.minIntervalSeconds * 1000;
    if (this.lastSentAt && gap < min) {
      // Jitter de ate 20s pra evitar cadencia robotica perfeita.
      const wait = min - gap + Math.random() * 20_000;
      logger.info({ waitMs: Math.round(wait) }, 'aguardando intervalo entre envios');
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  /**
   * Manda so texto, com um card de preview montado a mao (foto, titulo) em
   * vez de anexar a imagem como midia.
   *
   * Era `{ image: { url }, caption }`. O problema: imagem anexada baixa pra
   * galeria de todo mundo do grupo por padrao (auto-download do WhatsApp), e
   * um grupo ativo enche o armazenamento de quem participa ate a pessoa sair.
   * Card de preview nao e midia -- fica preso na bolha do texto, ninguem
   * baixa nada.
   *
   * `preview` e opcional so pra nao quebrar quem manda texto sem produto
   * associado; toda oferta de verdade tem foto e vai com ela.
   */
  async sendOffer(
    jid: string,
    text: string,
    preview?: { title: string; link: string; imageUrl?: string | null },
  ): Promise<string> {
    // Todo o envio (checagem de teto, intervalo, digitando, mandar, contar)
    // roda como bloco unico: e o que impede duas chamadas concorrentes
    // (clique manual + agendador + automacao) de passar juntas pela mesma
    // checagem antes de qualquer uma contar o proprio envio.
    return this.lock(async () => {
      if (!this.sock || this.status !== 'connected') {
        throw new WhatsAppRetryableError('WhatsApp desconectado. Pareie o numero em Conexoes.');
      }

      const day = await this.checkQuota();
      await this.waitInterval();

      // "Digitando..." antes de enviar deixa o comportamento mais proximo do humano.
      await this.sock.presenceSubscribe(jid).catch(() => undefined);
      await this.sock.sendPresenceUpdate('composing', jid).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1200 + Math.random() * 1800));
      await this.sock.sendPresenceUpdate('paused', jid).catch(() => undefined);

      // Passar `linkPreview` explicito -- mesmo sem thumbnail -- e o que faz o
      // Baileys pular a tentativa automatica dele, que sempre falha aqui (ver
      // gerarPreviewImagem). undefined so quando preview nem foi passado.
      //
      // `title` fica um espaco (nao string vazia) de proposito: o titulo do
      // produto ja e a primeira linha do texto da mensagem (ver renderMessage em
      // services/message.ts) -- repetir no card so duplica. Testado com string
      // vazia primeiro e o WhatsApp descarta o card inteiro (nem a foto aparece)
      // quando title === ''; com um espaco em branco o card renderiza normal e
      // o titulo fica invisivel, que e o efeito que queremos.
      const linkPreview = preview
        ? {
            'canonical-url': preview.link,
            'matched-text': preview.link,
            title: ' ',
            ...(preview.imageUrl ? await gerarPreviewImagem(this.sock, preview.imageUrl) : {}),
          }
        : undefined;

      const sent = await this.sock.sendMessage(jid, { text, linkPreview });

      this.lastSentAt = Date.now();
      await prisma.sendLog.update({ where: { day }, data: { count: { increment: 1 } } });

      return sent?.key?.id ?? '';
    });
  }

  async quotaToday() {
    const day = new Date().toISOString().slice(0, 10);
    const log = await prisma.sendLog.findUnique({ where: { day } });
    return { used: log?.count ?? 0, cap: env.wa.dailyCap };
  }
}

export const whatsapp = new WhatsAppService();
