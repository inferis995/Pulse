# Pulse Bridge

> **Progetto indipendente.** Pulse Bridge non è un prodotto ufficiale di Pulse e non è affiliato a Regncreative né da loro supportato. Per problemi del bridge apri una issue su [inferis995/Pulse](https://github.com/inferis995/Pulse/issues), non sul repository di Pulse. Proposta di collegamento: [Regncreative/Pulse#38](https://github.com/Regncreative/Pulse/issues/38).

Server [MCP](https://modelcontextprotocol.io/) che permette alle app di AI (**OpenCode**, **Claude Desktop**, **Claude Code**, **Cursor**, **VS Code**) di leggere le diagnostiche di [Pulse](../README.md) su un PC Windows.

- **Pulse non viene modificato.** Il bridge si collega a PulseService come client della sua named pipe (`\\.\pipe\PulseService`), esattamente come fa l'app Pulse.
- **Solo lettura.** Gli strumenti consultano eventi, salute del sistema, processi e diagnostica; nessuno modifica Windows.
- **Scegli tu l'AI.** Il modello lo decide l'app che usi: OpenCode Go/Zen, Claude, un modello locale, ecc.
- **Dati personali mascherati di default**, perché le risposte di solito finiscono a un modello cloud.

Pulse Bridge nasce da PulseMCP, il bridge MCP che Pulse includeva fino alla 1.2 ed è stato rimosso nella 1.3 per le dimensioni dell'installer ([ADR-013](../docs/architecture/decisions/ADR-013-remove-pulsemcp.md)). Qui vive come progetto separato, aggiornato al protocollo di Pulse 1.5.

```
PulseService (servizio Windows, non modificato)
      │  named pipe \\.\pipe\PulseService
      ▼
Pulse Bridge (questo progetto)  ── MCP su stdio ──►  OpenCode · Claude · Cursor · VS Code
```

## Requisiti

- Windows 10 o 11 con **Pulse 1.5** installato e PulseService in esecuzione
- [Node.js](https://nodejs.org/) 20 o successivo

## Installazione

```powershell
git clone https://github.com/inferis995/Pulse
cd Pulse\bridge
npm ci
npm run build
```

In alternativa, scarica lo zip `pulse-bridge-windows` dall'ultima esecuzione del workflow **Bridge** (tab Actions del repository): contiene già `dist` e le dipendenze, basta estrarlo.

Verifica:

```powershell
node dist\main.js --version
```

## Collegarlo a un'app di AI

Il bridge stampa la configurazione già pronta, con i percorsi giusti per il tuo PC:

```powershell
node dist\main.js --print-config opencode
node dist\main.js --print-config claude-desktop
node dist\main.js --print-config claude-code
node dist\main.js --print-config cursor
node dist\main.js --print-config vscode
```

Il bridge **non modifica** i file di configurazione delle app: copia tu lo snippet.

### OpenCode

Aggiungi lo snippet a `opencode.json` nel progetto, oppure a `~/.config/opencode/opencode.json` per averlo ovunque:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "pulse-bridge": {
      "type": "local",
      "command": ["C:\\Program Files\\nodejs\\node.exe", "C:\\percorso\\Pulse\\bridge\\dist\\main.js"],
      "enabled": true
    }
  }
}
```

Poi scegli il modello che preferisci in OpenCode (ad esempio OpenCode Go) e chiedi: *"Perché il mio PC si è riavviato stanotte?"*

### Claude Desktop

Impostazioni → Sviluppatore → Modifica configurazione (`%APPDATA%\Claude\claude_desktop_config.json`), aggiungi lo snippet in `mcpServers` e riavvia Claude Desktop.

### Claude Code

```powershell
claude mcp add --scope user pulse-bridge -- "C:\Program Files\nodejs\node.exe" C:\percorso\Pulse\bridge\dist\main.js
```

## Skill di diagnosi

[`skill/pulse-diagnosis/SKILL.md`](skill/pulse-diagnosis/SKILL.md) insegna all'AI come fare una diagnosi con questi strumenti: prima gli eventi critici, poi le metriche che contano, poi una risposta chiara con le prove.

- **Claude Code**: copia la cartella `pulse-diagnosis` in `%USERPROFILE%\.claude\skills\`.
- **Altre app**: incolla il contenuto del file nelle istruzioni del progetto o dell'agente.

## Strumenti

| Strumento | Cosa restituisce |
|---|---|
| `bridge_status` | Versioni, compatibilità con la versione di Pulse, mascheramento attivo, stato della connessione |
| `timeline_list`, `timeline_search` | Eventi di Windows spiegati in linguaggio semplice, con filtri per gravità, sorgente, Event ID, processo, periodo |
| `system_health` | Istantanea completa della salute del sistema |
| `system_cpu`, `system_memory`, `system_network` | Metriche correnti |
| `system_gpu` | Tutte le GPU (Pulse 1.5): carico, memoria, temperatura della principale |
| `system_storage` | Volumi, throughput e salute di ogni disco: SMART, usura NVMe, settori di riserva, errori, ore di accensione |
| `process_list`, `process_search`, `process_details` | Processi con CPU, memoria, editore, percorso, processo padre, tempo CPU |
| `diagnostics_snapshot`, `service_status` | Stato interno di PulseService |
| `report_export` | Scrive un report (json, csv, html, pdf, markdown) e ne restituisce il percorso |

Risorse con aggiornamenti live: `pulse://system/*`, `pulse://timeline/live`, `pulse://diagnostics/snapshot`, `pulse://bridge/status`.

## Privacy

Con il mascheramento attivo (predefinito), prima di uscire dal bridge ogni risposta passa per lo stesso filtro che Pulse usa per i report condivisi:

| Dato | Diventa |
|---|---|
| Nome utente, cartella `C:\Users\<nome>` | `[user]` |
| Nome del computer e del dominio | `[computer]` |
| SID degli account (`S-1-5-21-…`) | `S-1-5-21-[sid]` |
| Indirizzi IP e MAC, e-mail | `[ip]`, `[mac]`, `[email]` |
| Numeri di serie | `[serial]` |

Restano visibili ciò che serve per capire un problema: Event ID, sorgenti, orari, versioni, modelli hardware.

I **file** creati da `report_export` **non** sono mascherati: controllali prima di condividerli.

Ricorda che, con un modello cloud, i dati diagnostici del PC (anche mascherati) vengono inviati al fornitore del modello.

## Configurazione

File opzionale `%LOCALAPPDATA%\PulseBridge\config.json`:

```json
{ "enabled": true, "redact": true }
```

Le variabili d'ambiente hanno la precedenza sul file:

| Variabile | Effetto |
|---|---|
| `PULSE_BRIDGE_ENABLED=false` | Disattiva tutti gli strumenti |
| `PULSE_BRIDGE_REDACT=false` | Disattiva il mascheramento (sconsigliato con modelli cloud) |
| `PULSE_BRIDGE_CONFIG` | Percorso alternativo del file di configurazione |
| `PULSE_BRIDGE_LOG_DIR` | Cartella dei log (predefinita `%LOCALAPPDATA%\PulseBridge\logs`) |

## Aggiornamenti di Pulse

Il bridge dipende solo dal protocollo della pipe, non dal codice di Pulse:

- Quando Pulse aggiunge campi, il bridge continua a funzionare e semplicemente li ignora.
- `bridge_status` indica `pulseCompatibility: "untested"` quando PulseService è più recente delle versioni verificate (`PULSE_TESTED_VERSIONS` in `src/version.ts`).
- Dopo un aggiornamento di Pulse, confronta `shared/pulse_protocol/proto/pulse.proto` con la versione precedente. Se ci sono campi nuovi utili, aggiungili ai decoder in `src/health/decode.ts` e ai mapper.

## Problemi comuni

| Sintomo | Causa |
|---|---|
| `SERVICE_UNAVAILABLE` | PulseService non è in esecuzione: apri Pulse o avvia il servizio "PulseService" |
| `ACCESS_DENIED` sul canale Security | L'account di PulseService non può leggere il log Security: è normale |
| L'app di AI non vede gli strumenti | Percorsi errati nello snippet: rigeneralo con `--print-config` e riavvia l'app |
| Pulse segnala "pipe slots exhausted" | Troppi client aperti insieme: chiudi le app di AI che non usi |

I log sono in `%LOCALAPPDATA%\PulseBridge\logs`.

## Sviluppo

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

I test che richiedono PulseService vengono saltati automaticamente quando il servizio non è raggiungibile (ad esempio in CI su Linux).

## Licenza

MIT — vedi [LICENSE](LICENSE). Basato su PulseMCP di Regncreative, distribuito con licenza MIT. "Pulse" è il nome del progetto di Regncreative; qui è usato solo per indicare con cosa funziona il bridge.
