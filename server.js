require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
  MercadoPagoConfig,
  Payment
} = require("mercadopago");

const {
  retirarProduto,
  notificarVenda,
  verificarEstoque
} = require("./bot");


const app = express();

const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");


/*
|--------------------------------------------------------------------------
| CONFIGURAÇÃO
|--------------------------------------------------------------------------
*/

if (!process.env.MP_ACCESS_TOKEN) {

  console.error(
    "ERRO: MP_ACCESS_TOKEN não configurado."
  );

  process.exit(1);
}


const mpClient = new MercadoPagoConfig({

  accessToken: process.env.MP_ACCESS_TOKEN

});


const paymentClient = new Payment(mpClient);


/*
|--------------------------------------------------------------------------
| ARQUIVOS
|--------------------------------------------------------------------------
*/

if (!fs.existsSync(DATA_DIR)) {

  fs.mkdirSync(DATA_DIR, {
    recursive:true
  });

}


if (!fs.existsSync(ORDERS_FILE)) {

  fs.writeFileSync(
    ORDERS_FILE,
    "[]"
  );

}


/*
|--------------------------------------------------------------------------
| PLANOS
|--------------------------------------------------------------------------
*/

const PLANOS = {

  semanal:{
    nome:"Double Elixir - Semanal",
    valor:19.99,
    dias:7
  },

  mensal:{
    nome:"Double Elixir - Mensal",
    valor:29.99,
    dias:30
  },

  anual:{
    nome:"Double Elixir - Anual",
    valor:59.99,
    dias:365
  }

};


/*
|--------------------------------------------------------------------------
| FUNÇÕES DE PEDIDOS
|--------------------------------------------------------------------------
*/

function lerPedidos(){

  try{

    return JSON.parse(
      fs.readFileSync(
        ORDERS_FILE,
        "utf8"
      )
    );

  }catch{

    return [];

  }

}


function salvarPedidos(pedidos){

  fs.writeFileSync(
    ORDERS_FILE,
    JSON.stringify(
      pedidos,
      null,
      2
    )
  );

}


function criarPedido(pedido){

  const pedidos=lerPedidos();

  pedidos.push(pedido);

  salvarPedidos(pedidos);

  return pedido;

}


function atualizarPedido(orderId,alteracoes){

  const pedidos=lerPedidos();

  const index=pedidos.findIndex(
    pedido=>pedido.id===orderId
  );

  if(index===-1){

    return null;

  }

  pedidos[index]={
    ...pedidos[index],
    ...alteracoes
  };

  salvarPedidos(pedidos);

  return pedidos[index];

}


function gerarId(){

  return crypto.randomUUID();

}


/*
|--------------------------------------------------------------------------
| MIDDLEWARE
|--------------------------------------------------------------------------
*/

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname)
  )
);


/*
|--------------------------------------------------------------------------
| HOME
|--------------------------------------------------------------------------
*/

app.get("/api/status",(req,res)=>{

  res.json({

    success:true,

    service:"DOUBLE ELIXIR INFINITO!!",

    status:"online",

    mercadoPago:!!process.env.MP_ACCESS_TOKEN,

    telegram:!!process.env.TELEGRAM_BOT_TOKEN,

    estoque:verificarEstoque()

  });

});


/*
|--------------------------------------------------------------------------
| CRIAR PIX
|--------------------------------------------------------------------------
*/

app.post("/api/pix/create",async(req,res)=>{

  try{

    const {
      nome,
      playerId,
      email,
      plano
    }=req.body;


    if(!nome || !playerId || !email || !plano){

      return res.status(400).json({

        success:false,

        error:
        "Nome, ID, e-mail e plano são obrigatórios."

      });

    }


    const planoSelecionado=PLANOS[plano];


    if(!planoSelecionado){

      return res.status(400).json({

        success:false,

        error:"Plano inválido."

      });

    }


    /*
     * Confere estoque antes de receber pagamento.
     * Não libera produto aqui.
     */

    const estoque=verificarEstoque();

    if(estoque[plano] <= 0){

      return res.status(400).json({

        success:false,

        error:
        "Este plano está temporariamente sem estoque."

      });

    }


    const orderId=gerarId();


    const notificationUrl=
      process.env.WEBHOOK_URL ||
      `${req.protocol}://${req.get("host")}/api/webhook/mercadopago`;


    const payment=await paymentClient.create({

      body:{

        transaction_amount:
        planoSelecionado.valor,

        description:
        planoSelecionado.nome,

        payment_method_id:"pix",

        external_reference:
        `double-elixir:${orderId}`,

        notification_url:
        notificationUrl,

        payer:{

          email:email

        }

      },

      requestOptions:{

        idempotencyKey:orderId

      }

    });


    const transactionData=
      payment.point_of_interaction
      ?.transaction_data;


    if(!transactionData?.qr_code){

      throw new Error(
        "Mercado Pago não retornou o código Pix."
      );

    }


    const agora=
      new Date().toISOString();


    const pedido={

      id:orderId,

      paymentId:
      String(payment.id),

      nome,

      playerId,

      email,

      plano,

      valor:
      planoSelecionado.valor,

      dias:
      planoSelecionado.dias,

      status:
      payment.status || "pending",

      produto:null,

      criadoEm:agora,

      atualizadoEm:agora

    };


    criarPedido(pedido);


    res.json({

      success:true,

      orderId,

      paymentId:
      String(payment.id),

      status:
      payment.status,

      valor:
      planoSelecionado.valor,

      planoNome:
      planoSelecionado.nome,

      pix:{

        copiaECola:
        transactionData.qr_code,

        qrCodeBase64:
        transactionData.qr_code_base64 || null

      }

    });


  }catch(error){

    console.error(
      "Erro ao criar Pix:",
      error
    );


    res.status(500).json({

      success:false,

      error:
      "Não foi possível criar o pagamento."

    });

  }

});


/*
|--------------------------------------------------------------------------
| CONSULTAR PEDIDO
|--------------------------------------------------------------------------
*/

app.get("/api/order/:id",(req,res)=>{

  const pedido=
    lerPedidos().find(
      item=>item.id===req.params.id
    );


  if(!pedido){

    return res.status(404).json({

      success:false,

      error:"Pedido não encontrado."

    });

  }


  /*
   * Produto só é enviado depois da aprovação.
   */

  res.json({

    success:true,

    order:{

      id:pedido.id,

      plano:pedido.plano,

      valor:pedido.valor,

      status:pedido.status,

      produto:
      pedido.status==="approved"
      ?pedido.produto
      :null

    }

  });

});


/*
|--------------------------------------------------------------------------
| WEBHOOK MERCADO PAGO
|--------------------------------------------------------------------------
*/

app.post(
  "/api/webhook/mercadopago",
  async(req,res)=>{

    /*
     * Responde rapidamente ao Mercado Pago.
     */

    res.sendStatus(200);


    try{

      const data=req.body;


      let paymentId=null;


      if(data?.data?.id){

        paymentId=
          String(data.data.id);

      }


      if(!paymentId && data?.id){

        paymentId=
          String(data.id);

      }


      if(!paymentId){

        return;

      }


      /*
       * Nunca confiamos apenas no webhook.
       *
       * Consultamos o pagamento diretamente
       * na API do Mercado Pago.
       */

      const payment=
        await paymentClient.get({
          id:paymentId
        });


      const pedido=
        lerPedidos().find(
          item=>
          String(item.paymentId)===
          String(payment.id)
        );


      if(!pedido){

        console.log(
          "Pedido não encontrado:",
          payment.id
        );

        return;

      }


      /*
       * Se não estiver aprovado,
       * não entregamos nada.
       */

      if(payment.status!=="approved"){

        atualizarPedido(

          pedido.id,

          {

            status:
            payment.status || "pending",

            atualizadoEm:
            new Date().toISOString()

          }

        );

        return;

      }


      /*
       * Evita entregar duas vezes.
       */

      if(
        pedido.status==="approved" &&
        pedido.produto
      ){

        return;

      }


      /*
       * RETIRA UM PRODUTO DO ESTOQUE
       */

      const produto=
        retirarProduto(
          pedido.plano
        );


      if(!produto){

        console.error(
          "PAGAMENTO APROVADO, MAS SEM ESTOQUE:",
          pedido.id
        );


        atualizarPedido(

          pedido.id,

          {

            status:"approved_no_stock",

            atualizadoEm:
            new Date().toISOString()

          }

        );


        await notificarVenda({

          tipo:"SEM_ESTOQUE",

          pedido

        });


        return;

      }


      const aprovadoEm=
        new Date().toISOString();


      atualizarPedido(

        pedido.id,

        {

          status:"approved",

          produto,

          aprovadoEm,

          atualizadoEm:aprovadoEm

        }

      );


      /*
       * Avisa o administrador no Telegram.
       */

      await notificarVenda({

        tipo:"VENDA",

        pedido:{
          ...pedido,
          produto
        }

      });


      console.log(
        "Produto entregue:",
        pedido.id
      );


    }catch(error){

      console.error(
        "Erro no webhook:",
        error
      );

    }

  }
);


/*
|--------------------------------------------------------------------------
| ERROS
|--------------------------------------------------------------------------
*/

app.use(
  (err,req,res,next)=>{

    console.error(err);

    res.status(500).json({

      success:false,

      error:
      "Erro interno do servidor."

    });

  }
);


/*
|--------------------------------------------------------------------------
| INICIAR
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  ()=>{

    console.log(
      `DOUBLE ELIXIR INFINITO!! online na porta ${PORT}`
    );

  }
);
