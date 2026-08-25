import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Faltou a variavel ${name} no .env. Copie o .env.example e preencha.`);
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 3333),
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:3333').replace(/\/$/, ''),
  masterKey: required('MASTER_KEY'),
  dashboardPassword: required('DASHBOARD_PASSWORD'),
  sessionSecret: required('SESSION_SECRET'),
  wa: {
    stateDir: process.env.WA_STATE_DIR ?? './auth_state',
    minIntervalSeconds: Math.max(45, Number(process.env.WA_MIN_INTERVAL_SECONDS ?? 90)),
    dailyCap: Number(process.env.WA_DAILY_CAP ?? 40),
    /** Intervalo minimo entre remocoes. Remocao em rajada e padrao que o
     *  WhatsApp detecta -- o numero do usuario e o ganha-pao dele. */
    moderacaoIntervaloSegundos: Math.max(10, Number(process.env.WA_MODERACAO_INTERVALO_SEGUNDOS ?? 20)),
    /** Teto diario de remocoes. Conservador de proposito. */
    moderacaoTetoDiario: Number(process.env.WA_MODERACAO_TETO_DIARIO ?? 30),
  },
};

if (Buffer.from(env.masterKey, 'hex').length !== 32) {
  throw new Error('MASTER_KEY precisa ter 32 bytes em hex. Rode: npm run keygen');
}
