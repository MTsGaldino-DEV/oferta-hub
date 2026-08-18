import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type WASocket,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

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
          logger.error('Sessao encerrada no aparelho. Apague a pasta de sessao e pareie de novo.');
        } else {
          logger.warn({ code }, 'conexao caiu, reconectando em 5s');
          setTimeout(() => void this.connect(), 5000);
        }
      }
    });
  }

  async logout() {
    await this.sock?.logout().catch(() => undefined);
    this.sock = null;
    this.status = 'disconnected';
    this.qrDataUrl = null;
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

  async sendOffer(jid: string, text: string, imageUrl?: string | null): Promise<string> {
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

    const sent = imageUrl
      ? await this.sock.sendMessage(jid, { image: { url: imageUrl }, caption: text })
      : await this.sock.sendMessage(jid, { text, linkPreview: null } as any);

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
