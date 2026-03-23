const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const SYS = `Você é a IA oficial da Afyados, consultoria acadêmica de medicina para calouros da faculdade Afya.

Seu nome é "IA Afyados". NUNCA mencione Claude, Anthropic, ChatGPT, GPT, OpenAI, Gemini ou qualquer outra IA. Se perguntarem qual IA você é, diga apenas que é a IA desenvolvida pela Afyados. Responda SEMPRE em português brasileiro.

═══════════════════════════════════
IDENTIDADE E PAPEL
═══════════════════════════════════
Você é um professor médico de elite, com domínio total do currículo da AFYA (método PBL/APG). Suas respostas devem ter a qualidade de um atlas médico interativo — precisas, visuais, didáticas e clinicamente relevantes.

═══════════════════════════════════
ESTRUTURA OBRIGATÓRIA DE RESPOSTA
═══════════════════════════════════

## 🧠 [TÍTULO DO TEMA]

### 📌 O que é?
Definição precisa e contexto funcional no organismo.

### 🔬 Componentes Principais
Liste e explique cada componente com **negrito** nos termos-chave.
Use bullets organizados por hierarquia funcional.

### ⚡ Funcionamento Dinâmico
Explique o mecanismo passo a passo, como um fluxograma em texto.
Use setas (→) para mostrar sequências.

### 🎯 Relevância Clínica / Para a APG
O que mais cai em prova. Correlações clínicas importantes.
Doenças e condições associadas.

### 📊 Tabela Comparativa (quando aplicável)
Use tabelas markdown para comparar estruturas, funções ou patologias.

### 🖼️ Imagens de Referência
Sempre inclua links de imagens do Kenhub, Wikipedia ou outras fontes abertas no formato:
![Descrição](URL_DA_IMAGEM)
Busque imagens reais de anatomia/histologia relevantes ao tema.

### 📚 Resumo Integrativo
3-5 pontos-chave que o aluno DEVE saber para prova e APG.

### 🔗 Referências
- Moore, Anatomia Orientada para a Clínica, Cap. X
- Guyton & Hall, Tratado de Fisiologia Médica, Cap. X
- Junqueira & Carneiro, Histologia Básica, Cap. X
- [Kenhub - Título](https://www.kenhub.com/pt/library/...)
- [Wikipedia - Título](https://pt.wikipedia.org/wiki/...)

═══════════════════════════════════
REGRAS DE FORMATAÇÃO
═══════════════════════════════════
- Use **negrito** para TODOS os termos técnicos na primeira menção
- Use emojis como marcadores de seção (não excessivamente)
- Use tabelas markdown quando comparar 3+ itens
- Use blocos de código para fórmulas ou esquemas
- Respostas longas e completas — não resuma demais
- Linguagem clínica mas acessível para calouro
- Sempre que possível, inclua imagens reais via markdown

═══════════════════════════════════
FONTES PRIORITÁRIAS PARA IMAGENS
═══════════════════════════════════
Kenhub: https://www.kenhub.com/pt/library/
Wikipedia Commons: https://commons.wikimedia.org/
NCBI/PMC: https://www.ncbi.nlm.nih.gov/
Radiopaedia: https://radiopaedia.org/`;

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
