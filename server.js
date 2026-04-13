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

// Busca a URL da imagem principal de um artigo da Wikipedia (inglês)
// pra um termo de busca. Retorna null se não encontrar.
async function fetchWikiImage(term) {
  try {
    const url =
      'https://en.wikipedia.org/w/api.php?' +
      new URLSearchParams({
        action: 'query',
        format: 'json',
        prop: 'pageimages',
        piprop: 'original',
        pithumbsize: '500',
        generator: 'search',
        gsrsearch: term,
        gsrlimit: '1',
        origin: '*',
      }).toString();

    const r = await fetch(url, {
      headers: { 'User-Agent': 'AfyadosBot/1.0 (afyadoss.com.br)' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    for (const k in pages) {
      const p = pages[k];
      const img = p.original?.source || p.thumbnail?.source;
      if (img) return img;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// IA AFYADOS — Chat com API da OpenAI (ChatGPT) + Streaming
// ============================================================

const SYS = `Você é a IA oficial da Afyados, consultoria acadêmica de medicina para calouros da Afya. Nunca mencione Claude, Anthropic, ChatGPT, OpenAI ou Gemini. Você é a IA Afyados. Responda SEMPRE em português brasileiro.

REGRA DE IMAGENS — MUITO IMPORTANTE:
Em respostas sobre anatomia, fisiologia, histologia, embriologia ou qualquer tema médico visual, insira de 2 a 4 marcadores de imagem NO FORMATO EXATO:
[IMG: termo de busca em inglês]

O sistema buscará automaticamente imagens reais da Wikipedia com base nos termos. NUNCA gere URLs de imagem manualmente. NUNCA use a sintaxe markdown ![](). Use APENAS [IMG: ...] em inglês para ter mais chance de encontrar imagem.

Exemplos corretos:
[IMG: human heart anatomy]
[IMG: neuron structure]
[IMG: skeletal system]

Posicione os marcadores dentro do texto, perto de onde o conteúdo correspondente é explicado.

ESTRUTURA OBRIGATÓRIA:
## 🧠 [TÍTULO]
### 📌 O que é?
[Definição + [IMG: termo]]

### 🔬 Componentes
[Lista com **negrito** nos termos-chave + [IMG: termo]]

### ⚡ Funcionamento
[Mecanismo com setas → + [IMG: termo]]

### 🎯 Para a APG/Prova
[O que mais cai]

### 📊 Tabela comparativa (quando útil)

### 📚 Referências
[Moore, Guyton, Junqueira etc com capítulos]

Use **negrito** para termos técnicos. Respostas completas e detalhadas.`;

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'IA Afyados online ✅',
    model: 'gpt-4o',
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
    // Streaming SSE (formato "data: {...}\n\n") — compatível com o
    // parser atual do ia.html em produção.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 4000,
      stream: true,
      messages: [
        { role: 'system', content: SYS },
        ...cleanMessages,
      ],
    });

    // Buffer: acumula texto até detectar marcador [IMG: ...] completo.
    // Quando acha, busca imagem real na Wikipedia e substitui por markdown
    // de imagem antes de mandar pro frontend. Texto "seguro" (sem marcador
    // aberto) é enviado imediatamente em blocos de ~60ms.
    let pending = '';        // buffer bruto com possíveis marcadores incompletos
    let flushBuf = '';       // texto já processado, aguardando envio em lote
    let lastFlush = Date.now();
    const FLUSH_MS = 60;
    const imgRegex = /\[IMG:\s*([^\]]+)\]/;

    const sendChunk = (txt) => {
      if (!txt) return;
      res.write('data: ' + JSON.stringify({ text: txt }) + '\n\n');
    };

    const flushSafe = () => {
      if (flushBuf) {
        sendChunk(flushBuf);
        flushBuf = '';
      }
      lastFlush = Date.now();
    };

    // Processa 'pending': libera tudo que não tem marcador aberto,
    // e resolve marcadores completos (substituindo por imagem real).
    const processPending = async () => {
      while (true) {
        const match = pending.match(imgRegex);
        if (match) {
          // Texto antes do marcador é seguro pra enviar
          flushBuf += pending.slice(0, match.index);
          const term = match[1].trim();
          pending = pending.slice(match.index + match[0].length);
          // Flusha o que temos antes de bloquear pra buscar imagem
          flushSafe();
          const imgUrl = await fetchWikiImage(term);
          if (imgUrl) {
            sendChunk('\n\n![' + term + '](' + imgUrl + ')\n\n');
          }
        } else {
          // Sem marcador completo. Mas pode ter um '[' aberto aguardando '].
          // Mantemos os últimos 80 chars em pending pra não cortar marcador no meio.
          const openIdx = pending.lastIndexOf('[');
          if (openIdx !== -1 && pending.length - openIdx < 80) {
            flushBuf += pending.slice(0, openIdx);
            pending = pending.slice(openIdx);
          } else {
            flushBuf += pending;
            pending = '';
          }
          break;
        }
      }
    };

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        pending += delta;
        await processPending();
        if (Date.now() - lastFlush >= FLUSH_MS) {
          flushSafe();
        }
      }
    }

    // Fim do stream: libera qualquer resíduo (inclusive marcadores incompletos)
    flushBuf += pending;
    pending = '';
    flushSafe();
    res.write('data: [DONE]\n\n');
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
