export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  const expectedCode = process.env.CHAT_ACCESS_CODE;
  const suppliedCode = req.headers["x-chat-access-code"];
  if (!expectedCode || !suppliedCode || suppliedCode !== expectedCode) {
    return res.status(401).json({ error: "Código de acesso incorreto ou não configurado." });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "A chave da IA ainda não foi configurada no servidor." });
  }

  try {
    const raw = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const message = String(raw.message || "").trim().slice(0, 2000);
    if (!message) return res.status(400).json({ error: "Envie uma mensagem." });

    const finance = raw.finance && typeof raw.finance === "object" ? raw.finance : {};
    const history = Array.isArray(raw.history)
      ? raw.history.slice(-10).map(x => ({
          role: x.role === "assistant" ? "assistant" : "user",
          content: String(x.content || "").slice(0, 1500)
        }))
      : [];

    const instructions = `Você é o assistente oficial do Finance Control, um dashboard pessoal em português brasileiro.
Ajude a entender receitas, despesas, saldo, metas e lançamentos. Use somente os dados financeiros enviados nesta solicitação; não invente números.
Explique cálculos com clareza e seja objetivo. Não dê recomendações de investimento, crédito ou decisões financeiras de alto risco; ofereça apenas organização e educação financeira básica.
Se o usuário pedir para alterar dados, proponha ações estruturadas. Nunca diga que alterou algo: o navegador só aplicará depois de confirmação.
Responda SEMPRE como JSON válido, sem markdown, neste formato:
{"reply":"texto da resposta","actions":[]}
Cada ação deve ter um dos formatos:
{"type":"set_income","category":"Presentes|Emprestado|Salário|Outros|Cartas|Rolo","value":123}
{"type":"set_expense","category":"Dívidas|Parcelad|Cartas|Comida|Saídas|Roupas|Lazer|Jogos|Outros","value":123}
{"type":"set_goal","value":123}
{"type":"set_previous_balance","value":123}
{"type":"set_month","value":"Novembro 2026"}
{"type":"set_previous_month","value":"Outubro 2026"}
{"type":"add_transaction","description":"descrição curta","transactionType":"Receita|Despesa","category":"categoria válida","value":123}
Use actions=[] para perguntas e análises sem alteração. Só inclua ações quando o pedido do usuário for explícito e os dados necessários estiverem claros. Valores devem ser números positivos ou zero, em reais.`;

    const input = [
      { role: "user", content: "Dados atuais do Finance Control (JSON): " + JSON.stringify(finance) },
      ...history,
      { role: "user", content: message }
    ];

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-astra",
        instructions,
        input,
        text: { format: { type: "json_object" } },
        max_output_tokens: 900
      })
    });

    const result = await upstream.json();
    if (!upstream.ok) {
      console.error("OpenAI API error:", result.error?.message || upstream.status);
      return res.status(502).json({ error: "O serviço de IA retornou um erro. Verifique a configuração do modelo e o saldo da API." });
    }

    const output = (result.output || [])
      .filter(item => item.type === "message")
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n");

    let parsed;
    try { parsed = JSON.parse(output); }
    catch { return res.status(502).json({ error: "A IA retornou uma resposta em formato inesperado." }); }

    return res.status(200).json({
      reply: String(parsed.reply || "Não consegui formular uma resposta."),
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : []
    });
  } catch (error) {
    console.error("Chat handler error:", error);
    return res.status(500).json({ error: "Erro interno ao processar sua mensagem." });
  }
}
