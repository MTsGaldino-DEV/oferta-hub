import fs from 'node:fs/promises';
import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

/**
 * Baixa a foto do produto e devolve uma miniatura JPEG pro card de preview.
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
 * A saida: montar o preview a mao, com a foto que a gente ja tem salva.
 */
async function gerarThumbnail(url: string): Promise<Buffer | undefined> {
  try {
    const controle = new AbortController();
    const corte = setTimeout(() => controle.abort(), 5000);
    const res = await fetch(url, { signal: controle.signal });
    clearTimeout(corte);
    if (!res.ok) return undefined;

    const bruto = Buffer.from(await res.arrayBuffer());
    return await sharp(bruto).resize({ width: 192 }).jpeg({ quality: 70 }).toBuffer();
  } catch (err) {
    logger.warn({ url, err: String(err) }, 'nao consegui gerar miniatura do link');
    return undefined;
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

class WhatsAppService {
  private sock: WASocket | null = null;
  private lastSentAt = 0;
  status: Status = 'disconnected';
  qrDataUrl: string | null = null;
  me: string | null = null;

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
        logger.info({ me: this.me }, 'WhatsApp conectado');
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
    for (const [jid, meta] of Object.entries(groups)) {
      await prisma.whatsappGroup.upsert({
        where: { jid },
        create: { jid, name: meta.subject },
        update: { name: meta.subject },
      });
    }
    logger.info({ count: Object.keys(groups).length }, 'grupos sincronizados');
  }

  private async checkQuota() {
    const day = new Date().toISOString().slice(0, 10);
    const log = await prisma.sendLog.upsert({
      where: { day },
      create: { day, count: 0 },
      update: {},
    });
    if (log.count >= env.wa.dailyCap) {
      throw new Error(
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
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp desconectado. Pareie o numero em Conexoes.');
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
    // gerarThumbnail). undefined so quando preview nem foi passado.
    const linkPreview = preview
      ? {
          'canonical-url': preview.link,
          'matched-text': preview.link,
          title: preview.title,
          jpegThumbnail: preview.imageUrl ? await gerarThumbnail(preview.imageUrl) : undefined,
        }
      : undefined;

    const sent = await this.sock.sendMessage(jid, { text, linkPreview });

    this.lastSentAt = Date.now();
    await prisma.sendLog.update({ where: { day }, data: { count: { increment: 1 } } });

    return sent?.key?.id ?? '';
  }

  async quotaToday() {
    const day = new Date().toISOString().slice(0, 10);
    const log = await prisma.sendLog.findUnique({ where: { day } });
    return { used: log?.count ?? 0, cap: env.wa.dailyCap };
  }
}

export const whatsapp = new WhatsAppService();
