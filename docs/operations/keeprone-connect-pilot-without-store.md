# Piloto KeeproneConnect sem Chrome Web Store

A listagem pública na Store é Fase 6. Até a Google aprovar, o piloto usa
**extensão unpacked** (ou Trusted Testers no Developer Dashboard).

## Por que isso é suficiente

O protocolo (pairing assinado, capabilities, ingest) **não** depende da Store.
A Store só distribui o pacote. O ID da extensão precisa ser estável para o
Keepr falar com ela via `chrome.runtime.sendMessage`.

## Passos do piloto

1. Build **sem** flag de Store (mantém `key` do manifesto):

   ```bash
   cd apps/keeprone-connect
   pnpm exec wxt build
   ```

2. No Chrome do agente: `chrome://extensions` → Modo do desenvolvedor →
   **Carregar sem compactação** → pasta `.output/chrome-mv3`.

3. No Coolify / env do app:

   ```bash
   NATIONAL_LIFE_LOCAL_CONNECTOR_ENABLED=true
   NATIONAL_LIFE_LOCAL_CONNECTOR_EXTENSION_ID=<id estável do manifesto>
   ```

   **Não** defina `NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL` no piloto. Sem a
   URL, o Keepr entra em `installMode: pilot` e o card instrui unpacked em vez
   de abrir a Store.

   O `key` em `apps/keeprone-connect/.keys/manifest-key.txt` fixa o ID entre
   reloads. Sem ele, cada unpack gera ID novo e o card para de achar a extensão.

4. Quando a Store publicar: configure
   `NATIONAL_LIFE_LOCAL_CONNECTOR_STORE_URL` com a listing oficial que contém o
   mesmo extension ID. O card passa a `installMode: store` (botão abre a Store).

5. Smoke: siga `docs/operations/keeprone-connect-smoke-test.md` e valide o banco
   (`plannedGridKeys`, `writtenCount`, `raw`).

## Fallback sem extensão

Agentes que não puderem instalar Chrome unpacked usam o path **Steel remoto**
(login no viewer em `national-life-viewer.keeprone.com`), já existente. Cotação
FlexLife nesse path continua no job Rapid Solve até existir `FLEXLIFE_QUOTE`
na extensão — ver
`docs/superpowers/specs/2026-08-05-flexlife-quote-foresight-design.md`.

## Não fazer

- Distribuir `.crx` por download próprio (Chrome bloqueia).
- Pedir senha NLG no Keepr.
- Esperar a Store para validar sync com 2–5 agentes internos.
