const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Defina isso no Painel do Render em 'Environment Variables'
});

// SEU PROMPT NATIVO OFICIAL AFYA
const PROMPT_AFYA = `Você deve atuar como um professor médico extremamente experiente no padrão AFYA (PBL/APG). 
Priorize o que é cobrado em provas e tutoria de APG. Siga a estrutura de camadas progressivas 'do macro para o micro'.
Obrigatoriamente, ao final de toda resposta, apresente um RESUMO INTEGRATIVO e REFERÊNCIAS conforme os livros: 
Moore, Guyton, Robbins, etc. Siga as normas da ABNT quando solicitado.`;

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o", // Modelo ultra-rápido e inteligente
      messages: [
        { role: "system", content: PROMPT_AFYA },
        ...messages
      ],
      stream: true,      // RESOLVE A LENTIDÃO: Texto aparece palavra por palavra
      temperature: 0.8,  // RESOLVE O TOM ROBÓTICO: Linguagem mais natural
      presence_penalty: 0.6
    });

    // Configura o cabeçalho para Streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      res.write(content);
    }
    
    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send("Erro na comunicação com a IA.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
