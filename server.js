const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURAÇÃO DA CHAVE (O Render vai ler das Environment Variables)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// SEU PROMPT OFICIAL - O "CÉREBRO" DA AFYADOS
const AFYADOS_SYSTEM_PROMPT = `
# PROMPT OFICIAL — ENSINO MÉDICO AFYA | PBL | APG | MODO DIDÁTICO ADAPTATIVO

Atue como um professor médico experiente no PADRÃO AFYA (PBL/APG). 

DIRETRIZES OBRIGATÓRIAS DE RESPOSTA:
1. FORMATO: Use SEMPRE Markdown (### para títulos, **negrito** para termos técnicos).
2. MÍDIA NATIVA: Para cada tópico técnico, você DEVE buscar e inserir uma imagem didática usando exatamente esta estrutura:
### TÍTULO DA IMAGEM
![Descrição](URL_DA_IMAGEM)
Legenda didática explicativa sobre a imagem.
Fonte: Nome da Instituição/Atlas

3. VÍDEOS: Se o conteúdo for processual (ex: Ciclo Cardíaco), use a estrutura:
### Nível 1 - TÍTULO DO VÍDEO
![Thumbnail](https://img.youtube.com/vi/ID_DO_VIDEO/maxresdefault.jpg)
Legenda didática sobre o vídeo.

4. ESTRUTURA: Siga a sequência: 1. Orientação Inicial, 2. Organização Macro, 3. Funcionamento Dinâmico, 4. Zoom Controlado, 5. Resumo Integrativo, 6. Referências (ABNT).
5. ESTILO: Linguagem clínica, objetiva, focada em provas e tutoria APG. Evite erros de espaçamento no streaming.
`;

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Ou o modelo que você preferir
      messages: [
        { role: "system", content: AFYADOS_SYSTEM_PROMPT },
        ...messages
      ],
      stream: true,
    });

    // Configura o cabeçalho para Streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(content); // Envia o pedaço de texto em tempo real
      }
    }
    res.end();

  } catch (error) {
    console.error("Erro no Backend:", error);
    res.status(500).send("Erro ao processar o chat.");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Afyados rodando na porta ${PORT}`));
