export function Cupons() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Cupons</h1>
          <p>Códigos de desconto pra entrar automaticamente nas mensagens.</p>
        </div>
      </div>

      <div className="empty">
        <strong>Ainda não disponível</strong>
        O token <code>{'{CUPOM}'}</code> já funciona nos modelos de mensagem, mas o cadastro de cupons por
        loja chega numa próxima versão.
      </div>
    </>
  );
}
