require("dotenv").config();

const TelegramBot =
  require("node-telegram-bot-api");

const fs = require("fs");
const path = require("path");


const TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const ADMIN_ID =
  String(
    process.env.TELEGRAM_ADMIN_ID || ""
  );


if (
  !TOKEN ||
  TOKEN === "SEU_NOVO_TOKEN"
) {

  console.error(
    "Configure TELEGRAM_BOT_TOKEN no Render."
  );

  process.exit(1);

}


const bot =
  new TelegramBot(
    TOKEN,
    {
      polling: true
    }
  );


const STOCK_FILE =
  path.join(
    __dirname,
    "estoque.json"
  );


function estoqueVazio() {

  return {

    semanal: [],

    mensal: [],

    anual: []

  };

}


function loadStock() {

  if (!fs.existsSync(STOCK_FILE)) {

    fs.writeFileSync(

      STOCK_FILE,

      JSON.stringify(
        estoqueVazio(),
        null,
        2
      )

    );

  }


  try {

    const stock =
      JSON.parse(
        fs.readFileSync(
          STOCK_FILE,
          "utf8"
        )
      );


    if (!Array.isArray(stock.semanal))
      stock.semanal = [];

    if (!Array.isArray(stock.mensal))
      stock.mensal = [];

    if (!Array.isArray(stock.anual))
      stock.anual = [];


    return stock;


  } catch (error) {

    console.error(
      "Erro ao ler estoque:",
      error
    );

    return estoqueVazio();

  }

}


function saveStock(stock) {

  fs.writeFileSync(

    STOCK_FILE,

    JSON.stringify(
      stock,
      null,
      2
    )

  );

}


function isAdmin(msg) {

  return (
    String(msg.from?.id) ===
    ADMIN_ID
  );

}


/*
|--------------------------------------------------------------------------
| VER ESTOQUE
|--------------------------------------------------------------------------
*/

function verificarEstoque() {

  const stock =
    loadStock();


  return {

    semanal:
      stock.semanal.length,

    mensal:
      stock.mensal.length,

    anual:
      stock.anual.length

  };

}


/*
|--------------------------------------------------------------------------
| RETIRAR PRODUTO
|--------------------------------------------------------------------------
*/

function retirarProduto(plano) {

  const stock =
    loadStock();


  if (
    !stock[plano] ||
    stock[plano].length === 0
  ) {

    return null;

  }


  const produto =
    stock[plano].shift();


  saveStock(stock);


  return produto;

}


/*
|--------------------------------------------------------------------------
| NOTIFICAR VENDA
|--------------------------------------------------------------------------
*/

async function notificarVenda(dados) {

  if (!ADMIN_ID) {
    return;
  }


  try {

    if (
      dados.tipo ===
      "SEM_ESTOQUE"
    ) {

      const pedido =
        dados.pedido;


      await bot.sendMessage(

        ADMIN_ID,

        [
          "⚠️ PAGAMENTO APROVADO SEM ESTOQUE",
          "",
          `Pedido: ${pedido.id}`,
          `Plano: ${pedido.plano}`,
          `Cliente: ${pedido.nome}`,
          `ID: ${pedido.playerId}`,
          `Valor: R$ ${Number(pedido.valor).toFixed(2).replace(".", ",")}`
        ].join("\n")

      );

      return;

    }


    const pedido =
      dados.pedido;


    const estoque =
      verificarEstoque();


    await bot.sendMessage(

      ADMIN_ID,

      [
        "💰 NOVA VENDA",
        "",
        `Pedido: ${pedido.id}`,
        `Plano: ${pedido.plano}`,
        `Cliente: ${pedido.nome}`,
        `ID: ${pedido.playerId}`,
        `Valor: R$ ${Number(pedido.valor).toFixed(2).replace(".", ",")}`,
        "",
        "📦 1 produto retirado do estoque.",
        "",
        `Estoque semanal: ${estoque.semanal}`,
        `Estoque mensal: ${estoque.mensal}`,
        `Estoque anual: ${estoque.anual}`
      ].join("\n")

    );


  } catch (error) {

    console.error(
      "Erro ao enviar Telegram:",
      error
    );

  }

}


/*
|--------------------------------------------------------------------------
| /START
|--------------------------------------------------------------------------
*/

bot.onText(
  /^\/start$/,
  async msg => {

    await bot.sendMessage(

      msg.chat.id,

      [
        "🤖 Bot online!",
        "",
        "Use /ajuda para ver os comandos."
      ].join("\n")

    );

  }
);


/*
|--------------------------------------------------------------------------
| /AJUDA
|--------------------------------------------------------------------------
*/

bot.onText(
  /^\/ajuda$/,
  async msg => {

    await bot.sendMessage(

      msg.chat.id,

      [
        "📋 COMANDOS",
        "",
        "/estoque",
        "",
        "Adicionar produto:",
        "/adicionar plano LINK_ANDROID LINK_IOS CODIGO",
        "",
        "Exemplo:",
        "/adicionar mensal https://android.com https://ios.com ABC123",
        "",
        "Remover produto:",
        "/remover plano CODIGO",
        "",
        "Planos:",
        "semanal",
        "mensal",
        "anual"
      ].join("\n")

    );

  }
);


/*
|--------------------------------------------------------------------------
| /ESTOQUE
|--------------------------------------------------------------------------
*/

bot.onText(
  /^\/estoque$/,
  async msg => {

    if (!isAdmin(msg)) {
      return;
    }


    const estoque =
      verificarEstoque();


    await bot.sendMessage(

      msg.chat.id,

      [
        "📦 ESTOQUE ATUAL",
        "",
        `⚡ Semanal: ${estoque.semanal}`,
        `👑 Mensal: ${estoque.mensal}`,
        `∞ Anual: ${estoque.anual}`
      ].join("\n")

    );

  }
);


/*
|--------------------------------------------------------------------------
| /ADICIONAR
|--------------------------------------------------------------------------
|
| /adicionar mensal
| LINK_ANDROID
| LINK_IOS
| CODIGO
|
*/

bot.onText(

  /^\/adicionar\s+(semanal|mensal|anual)\s+(\S+)\s+(\S+)\s+(\S+)$/i,

  async (msg, match) => {

    if (!isAdmin(msg)) {
      return;
    }


    const plano =
      match[1].toLowerCase();

    const android =
      match[2].trim();

    const ios =
      match[3].trim();

    const codigo =
      match[4].trim();


    const produto = {

      android,

      ios,

      codigo,

      adicionadoEm:
        new Date().toISOString()

    };


    const stock =
      loadStock();


    stock[plano].push(
      produto
    );


    saveStock(stock);


    await bot.sendMessage(

      msg.chat.id,

      [
        "✅ PRODUTO ADICIONADO",
        "",
        `Plano: ${plano}`,
        "",
        `Android: ${android}`,
        `iOS: ${ios}`,
        `Código: ${codigo}`,
        "",
        `Estoque atual: ${stock[plano].length}`
      ].join("\n")

    );

  }

);


/*
|--------------------------------------------------------------------------
| /REMOVER
|--------------------------------------------------------------------------
*/

bot.onText(

  /^\/remover\s+(semanal|mensal|anual)\s+(\S+)$/i,

  async (msg, match) => {

    if (!isAdmin(msg)) {
      return;
    }


    const plano =
      match[1].toLowerCase();

    const codigo =
      match[2].trim();


    const stock =
      loadStock();


    const index =
      stock[plano].findIndex(

        item =>
          item &&
          typeof item === "object" &&
          item.codigo === codigo

      );


    if (index === -1) {

      await bot.sendMessage(

        msg.chat.id,

        "❌ Código não encontrado nesse estoque."

      );

      return;

    }


    stock[plano].splice(
      index,
      1
    );


    saveStock(stock);


    await bot.sendMessage(

      msg.chat.id,

      [
        "🗑️ PRODUTO REMOVIDO",
        "",
        `Plano: ${plano}`,
        `Código: ${codigo}`,
        `Estoque restante: ${stock[plano].length}`
      ].join("\n")

    );

  }

);


/*
|--------------------------------------------------------------------------
| ERROS DO TELEGRAM
|--------------------------------------------------------------------------
*/

bot.on(
  "polling_error",
  error => {

    console.error(
      "Telegram polling error:",
      error.message
    );

  }
);


console.log(
  "🤖 Bot Telegram iniciado."
);


/*
|--------------------------------------------------------------------------
| EXPORTAR PARA servidor.js
|--------------------------------------------------------------------------
*/

module.exports = {

  bot,

  retirarProduto,

  verificarEstoque,

  notificarVenda

};
