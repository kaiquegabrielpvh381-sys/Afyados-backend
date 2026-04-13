const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { registerFlashcardRoutes } = require('./flashcard-routes');

const app = express();
app.use(express.json());
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ============================================================
// IA AFYADOS — Chat com API da OpenAI (ChatGPT) + Streaming
// ============================================================

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
  res.json({
    status: 'IA Afyados online ✅',
    model: 'gpt-4o-mini',
    hasKey: !!process.env.OPENAI_API_KEY,
  });
});

// Chat endpoint com STREAMING via API nativa da OpenAI
app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mensagens inválidas' });
  }

  const cleanMessages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: String(m.content || '') }))
    .filter((m) => m.content.trim().length > 0);

  if (cleanMessages.length === 0) {
    return res.status(400).json({ error: 'Nenhuma mensagem válida' });
  }

  try {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 4000,
      stream: true,
      messages: [
        { role: 'system', content: SYS },
        ...cleanMessages,
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        res.write(delta);
      }
    }

    res.end();
  } catch (err) {
    console.error('Erro /chat:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Erro interno' });
    } else {
      res.end();
    }
  }
});

// ============================================================
// FLASHCARDS — Rotas de Flashcards + FSRS-5
// ============================================================

registerFlashcardRoutes(app);

// ============================================================
// START
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Afyados rodando na porta ${PORT}`));
