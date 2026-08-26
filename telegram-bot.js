require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "");

if (!TOKEN || TOKEN === "SEU_NOVO_TOKEN") {
  console.error("Configure TELEGRAM_BOT_TOKEN no arquivo .env");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const STOCK_FILE = "./estoque.json";

function loadStock() {
  if (!fs.existsSync(STOCK_FILE)) {
    fs.writeFileSync(STOCK_FILE, JSON.stringify({
      semanal: [],
      mensal: [],
      anual: []
    }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STOCK_FILE, "utf8"));
}

function saveStock(stock) {
  fs.writeFileSync(STOCK_FILE, JSON.stringify(stock, null, 2));
}

function isAdmin(msg) {
  return String(msg.from?.id) === ADMIN_ID;
}

function usage() {
  return [
    "/estoque",
    "/adicionar semanal CODIGO",
    "/adicionar mensal CODIGO",
    "/adicionar anual CODIGO",
    "/remover semanal CODIGO",
    "/remover mensal CODIGO",
    "/remover anual CODIGO"
  ].join("\n");
}

bot.onText(/^\/start$/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    "Bot online. Use /ajuda para ver os comandos."
  );
});

bot.onText(/^\/ajuda$/, async (msg) => {
  await bot.sendMessage(msg.chat.id, usage());
});

bot.onText(/^\/estoque$/, async (msg) => {
  if (!isAdmin(msg)) return;
  const s = loadStock();
  await bot.sendMessage(
    msg.chat.id,
    `Estoque atual:\n\n` +
    `Semanal: ${s.semanal.length}\n` +
    `Mensal: ${s.mensal.length}\n` +
    `Anual: ${s.anual.length}`
  );
});

bot.onText(/^\/(adicionar|remover)\s+(semanal|mensal|anual)\s+(.+)$/i, async (msg, match) => {
  if (!isAdmin(msg)) return;

  const action = match[1].toLowerCase();
  const plan = match[2].toLowerCase();
  const code = match[3].trim();

  if (!code) return;

  const stock = loadStock();

  if (action === "adicionar") {
    stock[plan].push(code);
    saveStock(stock);
    await bot.sendMessage(msg.chat.id, `Código adicionado ao estoque ${plan}.`);
    return;
  }

  const index = stock[plan].indexOf(code);
  if (index === -1) {
    await bot.sendMessage(msg.chat.id, "Código não encontrado nesse estoque.");
    return;
  }

  stock[plan].splice(index, 1);
  saveStock(stock);
  await bot.sendMessage(msg.chat.id, `Código removido do estoque ${plan}.`);
});

/*
 * Integração com o backend:
 *
 * Quando o pagamento Pix for aprovado, seu backend pode chamar:
 *
 * POST /internal/retirar-codigo
 * {
 *   "plano": "semanal"
 * }
 *
 * Este bot não cria nem confirma pagamentos. A confirmação deve vir
 * do seu provedor/backend de pagamentos.
 */
const http = require("http");

const PORT = Number(process.env.PORT || 3000);
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "";

function takeCode(plan) {
  const stock = loadStock();
  if (!["semanal", "mensal", "anual"].includes(plan)) {
    throw new Error("Plano inválido");
  }
  if (stock[plan].length === 0) return null;

  const code = stock[plan].shift();
  saveStock(stock);
  return code;
}

http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/internal/retirar-codigo") {
    res.writeHead(404, {"Content-Type": "application/json"});
    return res.end(JSON.stringify({ok:false}));
  }

  if (INTERNAL_KEY && req.headers["x-api-key"] !== INTERNAL_KEY) {
    res.writeHead(401, {"Content-Type": "application/json"});
    return res.end(JSON.stringify({ok:false, error:"unauthorized"}));
  }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => {
    try {
      const data = JSON.parse(body || "{}");
      const code = takeCode(String(data.plano || "").toLowerCase());

      if (!code) {
        res.writeHead(409, {"Content-Type": "application/json"});
        return res.end(JSON.stringify({ok:false, error:"estoque_vazio"}));
      }

      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({ok:true, codigo:code}));
    } catch (err) {
      res.writeHead(400, {"Content-Type": "application/json"});
      res.end(JSON.stringify({ok:false, error:err.message}));
    }
  });
}).listen(PORT, () => {
  console.log(`API interna rodando na porta ${PORT}`);
});
