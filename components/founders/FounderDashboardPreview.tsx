import { Logo } from "@/components/Logo";
import { NavIcon, type NavIconName } from "@/components/NavIcon";
import { KBotDrawing } from "@/components/kbot/KBotDrawing";
import styles from "./FounderDashboardPreview.module.css";

const navigation: {
  group: string;
  items: { label: string; icon: NavIconName }[];
}[] = [
  {
    group: "Operação",
    items: [
      { label: "Hoje", icon: "grid" },
      { label: "Agenda", icon: "calendar" },
      { label: "K-Bot AI", icon: "ai" },
      { label: "CRM", icon: "layers" },
      { label: "Mensagens", icon: "chat" },
    ],
  },
  {
    group: "Carteira",
    items: [
      { label: "Apólices", icon: "document" },
      { label: "Ilustrações", icon: "document" },
      { label: "Comissões", icon: "money" },
    ],
  },
  {
    group: "Gestão",
    items: [
      { label: "Agência", icon: "users" },
      { label: "Equipe", icon: "hierarchy" },
    ],
  },
];

const priorities = [
  {
    count: "03",
    title: "Pending Lapse",
    detail: "Clientes que precisam de contato",
    tone: "amber",
  },
  {
    count: "02",
    title: "Lapsed",
    detail: "Clientes para reativação",
    tone: "rose",
  },
  {
    count: "01",
    title: "Canceled",
    detail: "Acompanhe o relacionamento",
    tone: "neutral",
  },
];

/** Public, illustrative rendering of the current /agent UI. No customer data or API calls. */
export function FounderDashboardPreview() {
  return (
    <figure className={styles.preview}>
      <div
        className={styles.window}
        role="img"
        aria-label="Prévia ilustrativa do painel atual da Keepr One: navegação com Agenda e K-Bot AI, visão da carteira, prioridades de hoje e resumo da operação."
      >
        <div className={styles.canvas} aria-hidden="true">
          <div className={styles.browserBar}>
            <div className={styles.windowDots}>
              <i />
              <i />
              <i />
            </div>
            <span>
              <svg viewBox="0 0 16 16" fill="none">
                <rect
                  x="4"
                  y="7"
                  width="8"
                  height="6"
                  rx="1.5"
                  stroke="currentColor"
                />
                <path
                  d="M5.5 7V4.5a2.5 2.5 0 0 1 5 0V7"
                  stroke="currentColor"
                />
              </svg>
              app.keeprone.com
            </span>
            <NavIcon name="grid" size={13} />
          </div>
          <div className={styles.application}>
            <aside className={styles.sidebar}>
              <Logo size={27} className={styles.logo} />
              <div className={styles.workspace}>
                <small>WORKSPACE</small>
                <strong>Agência conectada</strong>
                <span>Plano Agência</span>
              </div>
              <div className={styles.navigation}>
                {navigation.map((group) => (
                  <div key={group.group}>
                    <p>{group.group}</p>
                    {group.items.map((item) => (
                      <div
                        className={`${styles.navItem} ${item.label === "Hoje" ? styles.active : ""}`}
                        key={item.label}
                      >
                        <NavIcon name={item.icon} size={15} />
                        <span>{item.label}</span>
                        {item.label === "K-Bot AI" && <i />}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className={styles.account}>
                <span>FO</span>
                <div>
                  <strong>Founder</strong>
                  <small>Área do agente</small>
                </div>
                <NavIcon name="settings" size={15} />
              </div>
            </aside>
            <div className={styles.workspaceMain}>
              <div className={styles.topbar}>
                <div>
                  <strong>Hoje</strong>
                  <span>Visão geral da sua operação</span>
                </div>
                <div>
                  <span className={styles.language}>PT</span>
                  <span className={styles.newCase}>+ Novo atendimento</span>
                </div>
              </div>
              <div className={styles.dashboard}>
                <div className={styles.heroGrid}>
                  <div className={styles.portfolio}>
                    <div className={styles.greeting}>
                      Bom dia, Founder!
                      <span>
                        Gerenciar K-Bot <span>↗</span>
                      </span>
                    </div>
                    <h3>
                      Sua carteira,
                      <br />
                      sob controle.
                    </h3>
                    <p>
                      O K-Bot organiza sua carteira e mostra o que precisa da
                      sua atenção.
                    </p>
                    <div className={styles.targetPremium}>
                      <small>Target Premium capturado</small>
                      <strong>Total da carteira em apuração</strong>
                      <span>
                        PC confirmado depende da evidência de pagamento.
                      </span>
                    </div>
                    <div className={styles.metrics}>
                      <div>
                        <span>Clientes ativos</span>
                        <strong>124</strong>
                        <small>conciliados</small>
                      </div>
                      <div>
                        <span>Apólices ativas</span>
                        <strong>148</strong>
                        <small>em vigor</small>
                      </div>
                      <div>
                        <span>Prêmio anual previsto</span>
                        <strong>$286.4k</strong>
                        <small>apólices ativas</small>
                      </div>
                    </div>
                    <div className={styles.health}>
                      <div>
                        <strong>Saúde da carteira</strong>
                        <small>National Life · visão consolidada</small>
                      </div>
                      <div className={styles.healthBar}>
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <div className={styles.healthLegend}>
                        <span>
                          <i />
                          Em dia <b>145</b>
                        </span>
                        <span>
                          <i />
                          Pending Lapse <b>3</b>
                        </span>
                        <span>
                          <i />
                          Lapsed <b>2</b>
                        </span>
                        <span>
                          <i />
                          Canceled <b>1</b>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.priorities}>
                    <div className={styles.priorityTitle}>
                      <h3>
                        Prioridades
                        <br />
                        de hoje
                      </h3>
                      <span>6</span>
                    </div>
                    <p>Comece pelo que precisa da sua atenção.</p>
                    {priorities.map((item) => (
                      <div className={styles.priorityRow} key={item.title}>
                        <span data-tone={item.tone}>{item.count}</span>
                        <div>
                          <strong>{item.title}</strong>
                          <small>{item.detail}</small>
                        </div>
                      </div>
                    ))}
                    <div className={styles.priorityFooter}>
                      Abrir carteira completa <span>↗</span>
                    </div>
                  </div>
                </div>
                <div className={styles.summary}>
                  <div>
                    <NavIcon name="layers" size={19} />
                    <strong>18</strong>
                    <span>oportunidades em andamento</span>
                    <small>CRM · Funil da operação</small>
                  </div>
                  <div>
                    <NavIcon name="calendar" size={19} />
                    <strong>Agenda</strong>
                    <span>Seus próximos compromissos</span>
                    <small>
                      Hoje · 14:30 <b>Reunião de acompanhamento</b>
                    </small>
                  </div>
                </div>
                <div className={styles.kbot}>
                  <span className={styles.kbotAvatar}>
                    <KBotDrawing state="idle" faceOnly />
                  </span>
                  <div>
                    <strong>K-Bot</strong>
                    <small>Sua operação, conectada.</small>
                  </div>
                  <i />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        <span>Uma prévia do seu próximo capítulo.</span>
        <span>Dados ilustrativos</span>
      </figcaption>
    </figure>
  );
}
