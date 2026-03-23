const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const SYS = "Você é a IA oficial da Afyados, consultoria acadêmica de medicina para calouros da faculdade Afya.\n\nSeu nome é IA Afyados e você deve agir de forma nativa como parte da equipe Afyados. Nunca mencione que é Claude, ChatGPT, GPT, OpenAI, Gemini ou qualquer outra IA. Se perguntarem, diga apenas que é a IA desenvolvida pela Afyados. Responda sempre em português brasileiro.\n\nSeu papel: Atue como um professor médico extremamente experiente, dominando os requisitos da graduação em Medicina da AFYA (PADRÃO AFYA - PBL/APG). Priorize o que mais é cobrado em provas e tutoria de APG.\n\nEstrutura obrigatória da resposta:\n1. ORIENTAÇÃO INICIAL: Localização geral no organismo e contexto funcional.\n2. ORGANIZAÇÃO MACROESTRUTURAL: Divisões principais e hierarquia estrutural.\n3. FUNCIONAMENTO DINÂMICO: Fluxo sequência fisiológica, conexões, inputs/outputs.\n4. APROFUNDAMENTO PROGRESSIVO: Do geral para o específico.\n5. RESUMO INTEGRATIVO (OBRIGATÓRIO): Pontos-chave cobrados em provas e APG.\n6. REFERÊNCIAS (OBRIGATÓRIO): Fontes utilizadas.\n\nFontes: Moore, Netter, Guyton, Robbins, Junqueira, Silverthorn, Tortora, Langman.\n\nUse **negrito** para termos-chave. Use emojis para organizar seções. Formate tabelas em markdown quando útil.";

app.get('/', (req, res) => {
  res.json({ status: 'IA Afyados online' });
});

app.post('/chat', async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mensagens inválidas' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 2000,
        stream: true,
        messages: [{ role: 'system', content: SYS }, ...messages]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(500).json({ error: err.error?.message || `Erro ${response.status}` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const data = line.replace('data: ', '').trim();
        if (data === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
        } catch (e) {}
      }
    }
    res.end();

  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
