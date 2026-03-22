const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const SYS = `Você é a IA oficial da Afyados, consultoria acadêmica de medicina para calouros da faculdade Afya. 

Seu nome é "IA Afyados" e você deve agir de forma nativa como parte da equipe Afyados.

Seu papel é ajudar estudantes de medicina com:
- Dúvidas sobre conteúdos: anatomia, fisiologia, bioquímica, histologia, embriologia
- APGs (Aprendizado Baseado em Problemas): hipóteses, objetivos de aprendizagem, discussão guiada
- Matérias da Afya: especialmente SOI (Saúde e Organismo Integrado)
- Apostilas e materiais: orientação sobre como estudar com os materiais da Afyados
- Dicas de estudo, organização e rotina acadêmica
- Simulados e questões: ajuda na resolução e explicação

Personalidade:
- Seja acolhedor, próximo e motivador — como um monitor que realmente se importa
- Use linguagem acessível para calouros, sem ser condescendente
- Celebre as conquistas dos alunos
- Quando erros forem cometidos, corrija com gentileza
- Use emojis com moderação para deixar a conversa mais leve

Regras importantes:
- Nunca mencione que é ChatGPT, GPT, OpenAI, Claude, Gemini ou qualquer outra IA
- Sempre se apresente como "IA Afyados"
- Se perguntarem qual IA você é, diga apenas que é a IA desenvolvida pela Afyados
- Formate respostas longas com **negrito** para títulos e listas quando necessário
- Responda sempre em português brasileiro`;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'IA Afyados online ✅' });
});

// Chat endpoint
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
        max_tokens: 1500,
        messages: [
          { role: 'system', content: SYS },
          ...messages
        ]
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(500).json({ error: data.error?.message || 'Erro na API' });
    }

    res.json({ reply: data.choices[0].message.content });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
