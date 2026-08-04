import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Política de privacidade · Keepr One',
  description: 'Política de privacidade do Keepr One e do KeeproneConnect.',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f6f8f5] px-6 py-16 text-[#17211b] sm:px-10">
      <article className="mx-auto max-w-3xl rounded-2xl border border-[#d9dfda] bg-white p-8 shadow-sm sm:p-12">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[#235c42]">Keepr One</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Política de privacidade</h1>
        <p className="mt-3 text-sm text-[#637068]">Última atualização: 4 de agosto de 2026</p>

        <div className="mt-10 space-y-8 text-[15px] leading-7 text-[#35423a]">
          <section>
            <h2 className="text-xl font-semibold text-[#17211b]">Escopo</h2>
            <p className="mt-2">
              Esta política explica como o Keepr One e a extensão KeeproneConnect tratam dados usados
              para sincronizar informações do portal National Life com a conta do agente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17211b]">Dados tratados</h2>
            <p className="mt-2">
              Quando o agente inicia uma sincronização, a extensão pode ler as tabelas exibidas no portal
              National Life e normalizar identificadores de apólice, nomes, contatos, datas, status,
              prêmios, valor acumulado e informações operacionais relacionadas à apólice. Esses dados são
              enviados ao Keepr One somente como registros estruturados e necessários para a sincronização.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17211b]">Login e segurança</h2>
            <p className="mt-2">
              O login e o MFA da National Life acontecem no navegador local do agente. O Keepr One e o
              KeeproneConnect não solicitam, armazenam nem enviam a senha, códigos MFA, cookies, tokens de
              sessão ou HTML bruto da carrier. A extensão mantém apenas o estado técnico necessário para
              o pareamento e para retomar uma sincronização.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17211b]">Uso e compartilhamento</h2>
            <p className="mt-2">
              Os dados são usados exclusivamente para executar, acompanhar e exibir a sincronização
              National Life dentro do Keepr One. Não vendemos dados e não os usamos para publicidade,
              crédito ou finalidades não relacionadas a esse propósito. Não compartilhamos os dados com
              terceiros, exceto quando necessário para operar o Keepr One ou quando exigido por lei.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17211b]">Retenção e solicitações</h2>
            <p className="mt-2">
              Os dados sincronizados seguem a retenção e os controles de acesso da conta do Keepr One. O
              agente pode desconectar o KeeproneConnect e solicitar ajuda sobre acesso, correção ou remoção
              de dados pelo suporte do Keepr One em{' '}
              <a className="font-semibold text-[#235c42] underline" href="https://app.keeprone.com">
                app.keeprone.com
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#17211b]">Alterações</h2>
            <p className="mt-2">
              Podemos atualizar esta política quando o produto ou seus controles de privacidade mudarem.
              A data no início desta página identifica a versão vigente.
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
