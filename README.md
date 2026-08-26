# Telegram Bot + Estoque

## 1. Instalar
```bash
npm install
```

## 2. Configurar
Copie `.env.example` para `.env` e coloque o token real do seu bot.

**Nunca publique o arquivo `.env` nem compartilhe seu token.**

## 3. Rodar
```bash
npm start
```

## Comandos do administrador
```text
/estoque
/adicionar semanal CODIGO
/adicionar mensal CODIGO
/adicionar anual CODIGO
/remover semanal CODIGO
/remover mensal CODIGO
/remover anual CODIGO
```

O `TELEGRAM_ADMIN_ID` limita esses comandos ao seu Telegram.

## Retirada automática após Pix aprovado

O endpoint interno é:

```text
POST /internal/retirar-codigo
Header: x-api-key: SUA_CHAVE
Body: {"plano":"semanal"}
```

Resposta quando houver código:

```json
{"ok":true,"codigo":"CODIGO"}
```

Se o estoque estiver vazio:

```json
{"ok":false,"error":"estoque_vazio"}
```

Este projeto **não confirma pagamentos por conta própria**. Seu backend/provedor Pix deve chamar o endpoint somente depois de receber uma confirmação legítima de pagamento aprovado.
