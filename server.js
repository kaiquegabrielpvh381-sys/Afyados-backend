const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const SYS = `Você é a IA oficial da Afyados, consultoria acadêmica de medicina para calouros da Afya. Nunca mencione Claude, Anthropic, ChatGPT, OpenAI ou Gemini. Você é a IA Afyados. Responda SEMPRE em português brasileiro.

REGRA CRÍTICA DE IMAGENS — OBRIGATÓRIO:
Em TODA resposta sobre anatomia, fisiologia, histologia ou qualquer tema médico visual, você DEVE incluir pelo menos 3 imagens usando markdown:
![Descrição da imagem](URL_DIRETA_DA_IMAGEM)

Use SEMPRE estas fontes de imagens reais e funcionais:
- Wikimedia Commons: https://upload.wikimedia.org/wikipedia/commons/thumb/[path]
- Wikipedia PT: https://pt.wikipedia.org/wiki/[tema]#/media/
- NCBI/PMC figuras abertas

Exemplos de imagens que funcionam:
![Coração humano](https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Diagram_of_the_human_heart_%28cropped%29.svg/400px-Diagram_of_the_human_heart_%28cropped%29.svg.png)
![Neurônio](https://upload.wikimedia.org/wikipedia/commons/thumb/1/10/Blausen_0657_MultipolarNeuron.png/400px-Blausen_0657_MultipolarNeuron.png)
![Célula](https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/Animal_cell_structure_en.svg/400px-Animal_cell_structure_en.svg.png)

ESTRUTURA OBRIGATÓRIA:
## 🧠 [TÍTULO]
### 📌 O que é?
[Definição + imagem relevante]

### 🔬 Componentes
[Lista com **negrito** nos termos-chave + imagem]

### ⚡ Funcionamento
[Mecanismo com setas → + imagem]

### 🎯 Para a APG/Prova
[O que mais cai]

### 📊 Tabela comparativa (quando útil)

### 🖼️ Galeria de Referências
[Mínimo 3 imagens markdown aqui]

### 📚 Referências
[Moore, Guyton, Junqueira etc com capítulos]

Use **negrito** para termos técnicos. Respostas completas e detalhadas.`;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'IA Afyados online ✅', model: 'claude-3-5-sonnet' });
});

// Chat endpoint with STREAMING via OpenRouter
app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mensagens inválidas' });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://afyadoss.com.br',
        'X-Title': 'IA Afyados'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-5',
        max_tokens: 4000,
        stream: true,
        messages: [
          { role: 'user', content: SYS + '\n\nConfirme que entendeu suas instruções respondendo: "Entendido. Sou a IA Afyados."' },
          { role: 'assistant', content: 'Entendido. Sou a IA Afyados.' },
          ...messages
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(500).json({ error: err.error?.message || `Erro ${response.status}` });
    }

    // Streaming headers
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
        if (data === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
          }
        } catch (e) {}
      }
    }

    res.end();

  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Afyados rodando na porta ${PORT}`));
