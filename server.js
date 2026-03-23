const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// Puxa a chave que você configurou no Environment do Render
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// SEU PROMPT OFICIAL AFYADOS
const AFYADOS_PROMPT = `
[COLE AQUI TODO AQUELE TEXTO DO PROMPT QUE VOCÊ ME ENVIOU ANTES, DESDE "PROMPT OFICIAL" ATÉ "ABNT"]

REGRAS EXTRAS PARA EVITAR ERROS NO SITE:
1. Nunca grude palavras. Use espaçamento duplo entre tópicos.
2. Para imagens, use obrigatoriamente: ### TÍTULO \n ![Descrição](URL) \n Legenda \n Fonte.
3. Se não encontrar uma imagem real, use uma de um atlas confiável como Kenhub ou Radiopaedia.
`;

app.post('/chat', async (req, res) => {
    const { messages } = req.body;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Modelo rápido e eficiente
            messages: [
                { role: "system", content: AFYADOS_PROMPT },
                ...messages
            ],
            stream: true, // Habilita o streaming para ser instantâneo
        });

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                res.write(content);
            }
        }
        res.end();

    } catch (error) {
        console.error("Erro:", error);
        res.status(500).send("Erro no servidor da IA.");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
