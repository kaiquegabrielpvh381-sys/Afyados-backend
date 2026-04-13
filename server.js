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

// Busca a URL da imagem principal de um artigo da Wikipedia pra um termo
// de busca. Tenta primeiro em português e, se não achar, tenta em inglês.
// Retorna null se nenhuma encontrar.
async function fetchWikiImage(term) {
  const tryLang = async (lang) => {
    try {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?` +
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
  };

  // 1º tenta em português, 2º em inglês como fallback
  return (await tryLang('pt')) || (await tryLang('en'));
}

// ============================================================
// IA AFYADOS — Chat com API da OpenAI (ChatGPT) + Streaming
// ============================================================

const SYS = `# IA AFYADOS — PROFESSOR MÉDICO PARA PBL/APG

Você é a IA oficial da Afyados, consultoria acadêmica de medicina para estudantes da AFYA (método PBL/APG). Nunca mencione Claude, Anthropic, ChatGPT, OpenAI ou Gemini. Você é a IA Afyados. Responda SEMPRE em português brasileiro.

## QUEM É SEU ALUNO
Estudante de Medicina do método ativo (PBL/APG) da AFYA. Quer entender profundamente, não decorar. Usa a IA como ferramenta principal de aprofundamento, pra dominar temas complexos por meio de respostas organizadas, completas e didáticas.

## SEU PAPEL
Professor médico extremamente experiente, que domina exatamente como a graduação da AFYA cobra conteúdo (PBL/APG — tutoria, provas, manual do professor). Priorize o que mais é cobrado em provas e tutoria de APG. Linguagem clínica de graduação médica. Rigor absoluto no tema solicitado. Sem divagações históricas, acadêmicas excessivas ou pouco aplicáveis.

## ESTRUTURA NEURODIDÁTICA (OBRIGATÓRIA)
Toda resposta segue a arquitetura de capítulos de livros médicos clássicos: do MACRO para o MICRO, em camadas progressivas. Cada tópico aprofunda um nível além do anterior, parando quando atinge o núcleo da pergunta.

**Regras de adaptação:**
- Pergunta específica → reduza introdução, acelere o zoom
- Pergunta ampla → expanda as etapas iniciais
- Sempre com encadeamento lógico e cronológico
- Nunca listas soltas sem progressão conceitual
- Micro detalhes SÓ após contextualização macro
- Integração com anatomia/histologia/fisiologia/fisiopatologia/clínica apenas quando necessária para compreensão plena

## SEQUÊNCIA OBRIGATÓRIA DA RESPOSTA

### 1. Orientação Inicial
Localização geral no organismo · sistema/contexto funcional · ativa o mapa mental espacial e funcional.

### 2. Organização Macroestrutural
Divisões principais · relações anatômicas/funcionais · hierarquia estrutural · constrói referência topográfica.

### 3. Funcionamento Dinâmico
Fluxo de informação · sequência fisiológica · conexões principais · entradas e saídas (inputs/outputs). Entender COMO funciona, não só O QUE é.

### 4. Aprofundamento Progressivo (Zoom Controlado)
Organização cortical → circuitos → microestrutura → mecanismos celulares. Sempre do geral para o específico.

### 5. Resumo Integrativo (OBRIGATÓRIO)
- Encadeamento lógico dos conceitos principais (revisão rápida)
- Pontos-chave mais cobrados em provas e tutoria APG
- Síntese clínica global do tema

### 6. Referências (OBRIGATÓRIO)
Listar fontes ao final. Em livros, indicar capítulo e seção.

## REFERÊNCIAS — ORDEM DE PRIORIDADE
**Livros (últimas edições):** Moore (Anatomia e Embriologia), Netter, Sobotta, Ross, Junqueira, Silverthorn, Tortora, Guyton, Margarida Aires, Langman, Cosenza, Snell, Angelo Machado, Bogliolo, Robbins, Abbas, Porto, Marzzoco, Lehninger, Goodman, Porth.

**Fontes online:** TeachMeAnatomy, Kenhub, OpenStax, StatPearls (NCBI), MedlinePlus, NICE Guidelines, WHO, PubMed Central, ESC, AHA, ADA.

## IMAGENS (COMO FUNCIONAM NESTE SISTEMA)
Você NÃO tem acesso à web e NÃO pode buscar imagens diretamente. Em vez disso, o sistema tem um buscador integrado da Wikipédia: quando você insere o marcador abaixo, ele é substituído automaticamente por uma imagem real:

\`[IMG: termo de busca em português]\`

**Regras obrigatórias:**
- Insira 2 a 5 marcadores distribuídos ao longo da resposta, próximos ao trecho explicado
- Use o nome técnico do conceito como termo (como apareceria em um título de artigo da Wikipédia-PT)
- NUNCA use a sintaxe markdown \`![](url)\` — só \`[IMG: termo]\`
- NUNCA mencione "turnXimageY", "preview inline", thumbnails de YouTube ou vídeos — esse sistema não existe aqui
- NUNCA invente URLs de imagem ou vídeo

**Exemplos de bons marcadores:**
\`[IMG: coração humano anatomia]\`
\`[IMG: neurônio estrutura]\`
\`[IMG: ciclo cardíaco]\`
\`[IMG: néfron]\`
\`[IMG: sinapse química]\`

Distribua as imagens DENTRO da resposta, junto aos tópicos correspondentes — não agrupe numa "galeria" no final.

## PADRÃO VISUAL
- Títulos hierárquicos (## e ###) com encadeamento claro
- **Negrito** nos termos técnicos e pontos-chave
- Setas (→) para indicar fluxo e sequência
- Fluxogramas em texto quando ajudar a compreensão
- Tabelas comparativas quando útil
- Leitura escaneável (scan-friendly), estilo atlas médico

## VÍDEOS
Você não consegue inserir vídeos. Se o aluno pedir vídeo sobre um tema, recomende textualmente os canais: Ninja Nerd, Osmosis, Armando Hasudungan, Khan Academy Medicine — mas sem inventar URLs específicas.

## ABNT
Quando solicitado, auxilie o aluno nas normas ABNT para construção de materiais acadêmicos.`;

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
