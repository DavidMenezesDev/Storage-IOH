# Integração do aplicativo cliente com o Storage-IOH

Guia para quem desenvolve o **aplicativo instalado no cliente** (a "outra aplicação"). Ele faz três coisas:

1. cadastra a empresa no Storage-IOH e recebe a **chave de integração**;
2. deixa o usuário escolher a **pasta de origem** dos backups;
3. configura o **envio automático diário às 15h ou 17h**.

Referência completa da API: [API-BACKUPS.md](API-BACKUPS.md).

---

## Visão geral

```
 Aplicativo cliente                         Storage-IOH (API)
 ──────────────────                         ─────────────────
 1. usuário informa Nome + CNPJ
    e escolhe pasta + horário (15h/17h)
 2. POST /api/enroll  ───────────────────▶  valida CNPJ, cria o cliente
    Bearer <ENROLL_SECRET>                  em clientes/<CNPJ>/ e gera a chave
 3. ◀───────────────────────────────────── { integrationKey, ingestUrl, ... }
 4. grava config + chave (protegida)
 5. grava enviar-backup.ps1 e registra
    tarefa agendada (todo dia 15:00/17:00)

 ── todo dia no horário escolhido ──
 6. compacta a pasta e envia
    PUT /api/ingest/backup-AAAA-MM-DD.zip ─▶ grava no storage, atualiza status
    Bearer <integrationKey>                  e alerta se o backup atrasar
```

---

## Configuração no servidor (uma vez, pelo admin)

1. Em **Conexões**, cadastre o storage onde os backups ficam e copie o **ID** da conexão.
2. No `.env` do servidor:

```ini
ENROLL_SECRET=<openssl rand -hex 24>
ENROLL_CONNECTION_ID=<id da conexão>
ENROLL_BUCKET=backups-erp
ENROLL_PREFIX=clientes/
```

3. `make up`. Sem `ENROLL_SECRET` a rota `/api/enroll` responde `404` (desligada).

O `ENROLL_SECRET` é embutido no aplicativo cliente. Ele só permite **cadastrar CNPJs novos**; não dá acesso
a backups nem a clientes já existentes.

---

## Passo a passo no aplicativo

### 1. Tela de cadastro

| Campo | Regra |
|---|---|
| Nome da empresa | obrigatório, até 200 caracteres |
| CNPJ | 14 dígitos, com ou sem máscara; valide os dígitos verificadores antes de enviar |
| Pasta de origem | seletor de pasta; confirme que existe e que o usuário tem leitura |
| Horário diário | `15:00` ou `17:00` (a API devolve as opções em `schedules`) |

### 2. Cadastrar na API

```http
POST {URL}/api/enroll
Authorization: Bearer <ENROLL_SECRET>
Content-Type: application/json

{ "name": "Empresa Exemplo LTDA", "document": "11.222.333/0001-81" }
```

`201 Created`:

```json
{
  "clientId": "6f1c…",
  "integrationKey": "ioh_9a8b…",
  "ingestUrl": "https://backup.exemplo.com.br/api/ingest/",
  "prefix": "clientes/11222333000181/",
  "schedules": ["15:00", "17:00"]
}
```

| Status | Significado | O que o aplicativo faz |
|---|---|---|
| `201` | cadastrado | segue para o passo 3 |
| `400` | nome vazio ou CNPJ inválido | mostra a mensagem em `error` e deixa corrigir |
| `401` | `ENROLL_SECRET` errado | erro de instalação: reinstalar/atualizar o aplicativo |
| `404` | cadastro desligado no servidor | avisar o administrador do servidor |
| `409` | CNPJ já cadastrado | orientar a pedir ao admin uma **nova chave** (painel: Cliente → Envio). A API não devolve chave de cliente existente |
| `503` | conexão de cadastro mal configurada no servidor | tentar mais tarde / avisar o administrador |

Erros vêm sempre como `{"error": "mensagem"}`.

### 3. Guardar a chave

A `integrationKey` **aparece só nesta resposta** e dá permissão de gravar backups em nome do cliente.

- Windows: grave em arquivo com ACL restrita a `SYSTEM` e Administradores (ou use DPAPI / Credential Manager).
- Linux: arquivo `0600` do usuário que roda o cron.
- Nunca registre a chave em log nem a mostre depois do cadastro.
- Guarde também `ingestUrl`, a pasta de origem e o horário escolhido.

### 4. Criar o script de envio (Windows)

Salve como `C:\ProgramData\StorageIOH\enviar-backup.ps1`, preenchendo as variáveis do topo:

```powershell
$ErrorActionPreference = "Stop"
$Pasta = "C:\ERP\Backup"                                   # pasta escolhida pelo usuário
$Url   = "https://backup.exemplo.com.br/api/ingest/"       # ingestUrl
$Key   = "ioh_..."                                         # integrationKey
$Log   = "C:\ProgramData\StorageIOH\envio.log"

$nome = "backup-" + (Get-Date -Format yyyy-MM-dd) + ".zip"
$zip  = Join-Path $env:TEMP $nome
try {
    Compress-Archive -Path "$Pasta\*" -DestinationPath $zip -Force
    Invoke-WebRequest -Method Put -InFile $zip -UseBasicParsing `
        -Headers @{ Authorization = "Bearer $Key" } -Uri ($Url + $nome) | Out-Null
    Add-Content $Log "$(Get-Date -Format s) OK $nome"
} catch {
    Add-Content $Log "$(Get-Date -Format s) ERRO $($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
```

Se a pasta já contém um arquivo de backup pronto (`.bak`, `.fbk`), envie esse arquivo direto em vez de compactar.
Arquivos em uso pelo banco podem falhar no `Compress-Archive`; prefira apontar para a pasta onde o ERP deposita o backup concluído.

### 5. Agendar (Windows)

Execute com privilégio de administrador (o instalador do aplicativo):

```powershell
$hora    = "15:00"    # ou "17:00", conforme a escolha do usuário
$acao    = New-ScheduledTaskAction -Execute "powershell.exe" `
           -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\StorageIOH\enviar-backup.ps1"'
$gatilho = New-ScheduledTaskTrigger -Daily -At $hora
$config  = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "Storage-IOH Backup" -Action $acao -Trigger $gatilho `
    -Settings $config -User "SYSTEM" -RunLevel Highest -Force
```

- `-StartWhenAvailable`: se o computador estava desligado às 15h, roda assim que ligar.
- `-RestartCount/-RestartInterval`: 3 novas tentativas, de 15 em 15 minutos, se o envio falhar.
- Para trocar o horário depois, rode `Register-ScheduledTask ... -Force` de novo com o novo `$hora`.
- Para remover: `Unregister-ScheduledTask -TaskName "Storage-IOH Backup" -Confirm:$false`.

### Linux (cron)

`/opt/storage-ioh/enviar-backup.sh` (`chmod 700`):

```bash
#!/bin/sh
set -e
PASTA=/var/backups/erp
URL=https://backup.exemplo.com.br/api/ingest/
KEY=ioh_...
NOME="backup-$(date +%F).tar.gz"
tar -czf "/tmp/$NOME" -C "$PASTA" .
trap 'rm -f "/tmp/$NOME"' EXIT
curl -fS -T "/tmp/$NOME" -H "Authorization: Bearer $KEY" "$URL$NOME"
```

```cron
0 15 * * *  /opt/storage-ioh/enviar-backup.sh >> /var/log/storage-ioh.log 2>&1   # ou 0 17
```

---

## Envio de backup (contrato)

```http
PUT {ingestUrl}{nome-do-arquivo}
Authorization: Bearer <integrationKey>
Content-Length: <bytes>
<corpo = bytes do arquivo, em stream>
```

- O arquivo é gravado em `prefix + nome-do-arquivo` (ex.: `clientes/11222333000181/backup-2026-11-13.zip`).
- Subpastas são aceitas (`2026/11/base.bak`); `..` é recusado.
- Use o **nome com data**: reenviar o mesmo nome no mesmo dia sobrescreve o arquivo.
- `201 {"key": "...", "size": 123}` sucesso · `401` chave inválida/revogada · `403` cliente inativo ·
  `413` acima do limite (`INGEST_MAX_GB`) · `400` nome inválido ou envio incompleto.
- Em `401`, não insistir em loop: registrar no log e avisar o usuário (a chave foi revogada ou regerada pelo admin).

---

## Monitoramento e alertas

A cada envio o Storage-IOH atualiza o status do cliente imediatamente. A política padrão do cadastro automático é
backup a cada **24 h** com **6 h de tolerância**:

| Status | Quando |
|---|---|
| Em dia | último backup dentro de 30 h |
| Atrasado | mais de 30 h sem backup (ex.: envio das 15h que falhou por dois dias) |
| Suspeito | arquivo menor que 1 KB ou mais de 50% menor que a média dos 7 anteriores |
| Sem backup | nenhum arquivo encontrado após a janela esperada |

Mudanças de status geram alertas por webhook/e-mail (configurados em **Alertas**). Tudo fica na auditoria
(`client.enroll`, `backup.ingest`).

---

## Casos especiais

- **Reinstalação / chave perdida:** o `/enroll` devolve `409`. O admin abre o cliente no painel e gera uma nova chave
  (isso invalida a anterior); o aplicativo precisa de um campo para colar a chave manualmente.
- **Trocar a pasta de origem ou o horário:** é local ao cliente; basta regravar o script/tarefa. Nada muda no servidor.
- **Desativar o cliente:** o admin marca como inativo; os envios passam a receber `403`.

## Checklist de implementação

- [ ] Validar CNPJ (dígitos verificadores) antes de chamar a API
- [ ] Tratar `400/401/404/409/503` com mensagens claras
- [ ] Guardar a chave com permissão restrita; nunca logar
- [ ] Gerar o script com pasta, URL e chave preenchidas
- [ ] Registrar a tarefa com `StartWhenAvailable` e novas tentativas
- [ ] Enviar nome de arquivo com data
- [ ] Registrar resultado de cada envio em log local
- [ ] Opção de colar chave manualmente (caso `409`)

CHAVES: 

Item	Valor
URL base	https://storage.jamsofttecnologia.com.br
Rota de cadastro	POST /api/enroll
ENROLL_SECRET (chave embutida no app do cliente)	af378d4c3a7909163bc4804d1cb0cd64a321987fad40461a
ENROLL_CONNECTION_ID	1006eda0-91ad-476d-adf0-1aecf8ae1bf7 (conexão "Storage")
ENROLL_BUCKET / ENROLL_PREFIX	uploads / clientes/