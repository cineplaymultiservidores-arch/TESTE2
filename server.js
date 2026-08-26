require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

if (!process.env.MP_ACCESS_TOKEN) {
  console.error("ERRO: MP_ACCESS_TOKEN não configurado.");
  process.exit(1);
}

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN
});

const paymentClient = new Payment(mpClient);

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]");

const PLANOS = {
  semanal: { nome: "Double Elixir - Semanal", valor: 19.99, dias: 7 },
  mensal: { nome: "Double Elixir - Mensal", valor: 29.99, dias: 30 },
  anual: { nome: "Double Elixir - Anual", valor: 59.99, dias: 365 }
};

function lerPedidos() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function salvarPedidos(pedidos) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(pedidos, null, 2));
}

function criarPedido(dados) {
  const pedidos = lerPedidos();
  pedidos.push(dados);
  salvarPedidos(pedidos);
  return dados;
}

function atualizarPedido(orderId, alteracoes) {
  const pedidos = lerPedidos();
  const index = pedidos.findIndex(pedido => pedido.id === orderId);
  if (index === -1) return null;

  pedidos[index] = { ...pedidos[index], ...alteracoes };
  salvarPedidos(pedidos);
  return pedidos[index];
}

function gerarId() {
  return crypto.randomUUID();
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "DOUBLE ELIXIR INFINITO!!",
    status: "online"
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    mercadoPago: !!process.env.MP_ACCESS_TOKEN,
    webhook: !!process.env.WEBHOOK_URL,
    entrega: !!process.env.DELIVERY_API_URL
  });
});

app.post("/api/pix/create", async (req, res) => {
  try {
    const { nome, playerId, plano } = req.body;

    if (!nome || !playerId || !plano) {
      return res.status(400).json({
        success: false,
        error: "Nome, ID e plano são obrigatórios."
      });
    }

    const planoSelecionado = PLANOS[plano];

    if (!planoSelecionado) {
      return res.status(400).json({
        success: false,
        error: "Plano inválido."
      });
    }

    const orderId = gerarId();

    const notificationUrl =
      process.env.WEBHOOK_URL ||
      `${req.protocol}://${req.get("host")}/api/webhook/mercadopago`;

    const payment = await paymentClient.create({
      body: {
        transaction_amount: planoSelecionado.valor,
        description: planoSelecionado.nome,
        payment_method_id: "pix",
        external_reference: `double-elixir:${orderId}`,
        notification_url: notificationUrl,
        payer: {
          email:
            process.env.DEFAULT_PAYER_EMAIL ||
            "cliente@example.com"
        }
      },
      requestOptions: {
        idempotencyKey: orderId
      }
    });

    const pedido = {
      id: orderId,
      paymentId: String(payment.id),
      nome,
      playerId,
      plano,
      valor: planoSelecionado.valor,
      dias: planoSelecionado.dias,
      status: "pending",
      produto: null,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString()
    };

    criarPedido(pedido);

    const transactionData =
      payment.point_of_interaction?.transaction_data;

    res.json({
      success: true,
      orderId,
      paymentId: String(payment.id),
      status: payment.status,
      statusDetail: payment.status_detail,
      valor: planoSelecionado.valor,
      pix: {
        copiaECola: transactionData?.qr_code || null,
        qrCodeBase64: transactionData?.qr_code_base64 || null
      }
    });
  } catch (error) {
    console.error("Erro ao criar Pix:", error);
    res.status(500).json({
      success: false,
      error: "Não foi possível criar o pagamento."
    });
  }
});

app.get("/api/order/:id", (req, res) => {
  const pedido = lerPedidos().find(
    item => item.id === req.params.id
  );

  if (!pedido) {
    return res.status(404).json({
      success: false,
      error: "Pedido não encontrado."
    });
  }

  res.json({
    success: true,
    order: {
      id: pedido.id,
      plano: pedido.plano,
      valor: pedido.valor,
      status: pedido.status,
      produto: pedido.produto
    }
  });
});

app.post("/api/webhook/mercadopago", async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body;

    let paymentId = null;

    if (data?.data?.id) paymentId = String(data.data.id);
    if (!paymentId && data?.id) paymentId = String(data.id);

    if (!paymentId) return;

    const payment = await paymentClient.get({ id: paymentId });

    const pedido = lerPedidos().find(
      item => String(item.paymentId) === String(payment.id)
    );

    if (!pedido) return;

    if (payment.status !== "approved") {
      atualizarPedido(pedido.id, {
        status: payment.status || "pending",
        atualizadoEm: new Date().toISOString()
      });
      return;
    }

    if (pedido.status === "approved" && pedido.produto) return;

    const produto = await entregarProduto(pedido);

    atualizarPedido(pedido.id, {
      status: "approved",
      produto,
      atualizadoEm: new Date().toISOString(),
      aprovadoEm: new Date().toISOString()
    });

    console.log("Produto entregue:", pedido.id);
  } catch (error) {
    console.error("Erro no webhook:", error);
  }
});

async function entregarProduto(pedido) {
  if (!process.env.DELIVERY_API_URL) {
    return {
      tipo: "pending_delivery",
      mensagem:
        "Pagamento aprovado. Configure a API de entrega."
    };
  }

  const response = await fetch(process.env.DELIVERY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.DELIVERY_API_KEY}`
    },
    body: JSON.stringify({
      nome: pedido.nome,
      playerId: pedido.playerId,
      plano: pedido.plano,
      dias: pedido.dias,
      orderId: pedido.id
    })
  });

  if (!response.ok) {
    throw new Error(
      `API de entrega respondeu ${response.status}`
    );
  }

  return await response.json();
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    success: false,
    error: "Erro interno do servidor."
  });
});

app.listen(PORT, () => {
  console.log(
    `DOUBLE ELIXIR INFINITO!! online na porta ${PORT}`
  );
});
